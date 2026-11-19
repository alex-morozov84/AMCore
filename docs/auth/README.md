# Authentication & Authorization

Use this index to choose a sign-in, session or authorization guide.
Authentication identifies the caller. Authorization decides which actions that caller may perform.

---

[Organization establishment](../product-admin/organization-establishment.md) separates
personal signup, explicit company creation, trusted first organization ADMIN and
first platform SUPER_ADMIN access.

[Member API-key control](../product-admin/member-api-keys.md) covers organization-scoped inventory, permanent
revocation, member removal and bounded operator recovery.

## What's included

[Account MFA architecture](mfa-foundation.md) describes storage, current session
authority, one-time proofs and [extension to other users](mfa-foundation.md#extend-mfa-to-other-users). [Browser journeys](mfa-browser.md) cover
setup, self-service and safe recovery. [Deployment and maintenance](mfa-deployment.md)
cover activation, offline reset and key rotation. Activation requires separate owner
approval; the default prepared protocol does not enable MFA or operator grants.

| Topic                                                 | What it covers                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Concepts](./concepts.md)                             | How tokens, sessions, and the security model work                                  |
| [CSRF Posture](./csrf.md)                             | Which cookie surfaces exist and how CSRF is handled                                |
| [Email Auth](./email-auth.md)                         | Register, login, password reset, email verification                                |
| [OAuth](./oauth.md)                                   | Google/GitHub/Apple login, provider linking and link-only Telegram                   |
| [Sessions](./sessions.md)                             | Own/admin session listing and revocation, rotation, device/IP/location metadata    |
| [RBAC](./rbac.md)                                     | System roles, organizations, permissions, CASL — the auth-z guide                  |
| [Redis outage behavior](./redis-outage.md)            | What authentication does when Redis is slow or down: `503`, deadlines, recovery    |
| [Capability catalogue](./capability-catalogue.md)     | Implemented actions, permission presets and actor/record access hints              |
| [Organization context](./organization-context.md)     | Explicit API-verified targets, typed session-fenced transport and tenant extension |
| [Authorization upgrade](./authorization-upgrade.md)   | Audit and controlled transition to explicit defaults and TeamAccess                |
| [Invites](./invites.md)                               | Complete role intent, explicit consent, scoped signup and recovery                 |
| [API Keys](./api-keys.md)                             | Machine-to-machine access with scoped keys                                         |
| [Auth contracts](./reference.md)                      | Credential model, error codes, environment variables                               |
| [Operations Console](../operations-console/README.md) | Separate `SUPER_ADMIN` control-plane admission and host session boundary           |

---

## The 30-second mental model

For direct API consumers (mobile apps, scripts, or a custom frontend that talks
to `apps/api` itself), AMCore is a bearer-token API:

```
Who are you?  →  Authentication  →  JWT access token (default 15 min)
                                     + refresh token in cookie (default 7 days)

What can you do?  →  Authorization  →  System role (USER / SUPER_ADMIN)
                                        + Organization roles (custom)
                                        + CASL permission rules
```

Send the access token on protected API requests. Request refresh before continuing
with an expired token. Refresh can fail after expiry, revocation or authority changes;
follow [session recovery](./sessions.md#refresh-the-access-token).

The bundled Next.js app (`apps/web`) deliberately wraps that API contract in a
BFF / Token Handler layer (ADR-068): the browser never receives the backend
access token or long-lived refresh token. It holds only `amcore_session`, an
opaque httpOnly cookie for `apps/web`; Next Route Handlers keep the backend
tokens in a Redis session vault and attach `Authorization: Bearer ...`
server-side. The only short exception is the OAuth callback handoff described in
[OAuth](./oauth.md), where a temporary HttpOnly callback-binding nonce, named `refresh_token`, is relayed
onto the selected frontend origin. The localized completion document submits
its native form to a dedicated same-origin POST handler, which consumes/deletes
the temporary cookie. The GET document itself never exchanges or publishes a
session. Generic forwarding of JWT issuance, including
organization switch, is denied; see
[Credential containment](../frontend/api-consumption.md#credential-containment).

When the optional Operations Console uses its separate host mode, it has a
second, deliberately isolated BFF boundary: `__Host-amcore_console_session`
points only to `web:console-session:v1:*` entries carrying the `console`
audience. It is not a product session and cannot authenticate product BFF
routes; conversely, `amcore_session` cannot admit the console. See
[Sessions](./sessions.md#operations-console-host-mode) and
[CSRF Posture](./csrf.md#operations-console-host-mode).

---

## Quick start

1. Choose the client boundary. Direct clients call the API; bundled web clients
   use the same-origin BFF and never handle backend credentials in browser code.
2. Follow [email registration and login](./email-auth.md), or
   [OAuth login](./oauth.md#initiating-oauth-login). A login `202` is an intermediate
   continuation, not ordinary access. It can occur without a human MFA challenge.
3. Follow [sessions](./sessions.md) for refresh, logout and revocation. For protected
   accounts, read the linked MFA guidance; deployment activation requires separate approval.

---

## Authentication methods

The system supports three ways to authenticate a request:

| Method         | How                                     | Use case                  |
| -------------- | --------------------------------------- | ------------------------- |
| **JWT Bearer** | `Authorization: Bearer {accessToken}`   | Web/mobile apps, users    |
| **API Key**    | `Authorization: Bearer amcore_live_...` | Server-to-server, scripts |
| **None**       | No header                               | Public endpoints          |

JWT and API key share the same `Authorization: Bearer` header — the
server tells them apart by the token format. Authenticated routes are
JWT-only by default; only the explicit API-key allowlist accepts
`amcore_live_...` credentials. Credential and session management routes
(`/api-keys/**`, `/auth/sessions/**`) require a JWT specifically — see
[API Keys](./api-keys.md).

---

The [ready invitation UI](../product-admin/invitations.md) provides manager and
recipient scenarios; custom downstream screens can reuse its headless contracts.

## Environments

| Variable                | Description                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| `JWT_SECRET`            | Signs access tokens — keep this secret                                       |
| `JWT_ACCESS_EXPIRATION` | Access token lifetime (default: `15m`)                                       |
| `JWT_REFRESH_DAYS`      | Refresh token lifetime (default: `7`)                                        |
| `FRONTEND_URL`          | Frontend origin; user-facing paths add the locale via `localizedFrontendUrl` |

See [Auth contracts](./reference.md#environment-variables) for the full list.

## HTTP cookie integration

The API uses Fastify cookies. Cookie `maxAge` values use seconds; existing refresh
and OAuth binding helpers preserve their lifetimes, scopes and secure flags.
New handlers must follow [HTTP runtime](../backend/http-runtime.md).
