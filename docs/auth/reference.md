# Auth API contracts

Endpoint shapes — paths, request/response bodies, status codes — live in the
Swagger/OpenAPI document at `/docs` in development. This page covers only the
auth contracts OpenAPI does not fully express: the credential model, the stable
error-code catalog for frontend localization, and environment variables.

**Base URL:** `https://api.example.com/api/v1` (replace with your deployment).

---

## Credential model

Both credential types ride on the same header — the server disambiguates by
token format:

```
Authorization: Bearer {accessToken | amcore_live_...}
```

The Swagger UI at `/docs` documents this as two named bearer schemes —
`bearer` (JWT) and `apiKeyBearer` (`amcore_live_<id>_<secret>`) — rather than
a separate header, since both credential types ride the same
`Authorization: Bearer` transport.

| Symbol | Meaning              |
| ------ | -------------------- |
| 🔓     | Public — no auth     |
| 🔑     | JWT required         |
| 🗝️     | JWT **or** API key   |
| 🍪     | Refresh-token cookie |

- **Management routes are JWT-only.** `/api-keys/**` and `/auth/sessions/**`
  reject API-key auth with `401` — a key cannot mint or revoke credentials.
- **`GET /auth/me` accepts either** (🗝️) and is the canonical identity
  self-check for integrations.
- **Email identity is case-insensitive** via a server-side canonical key, while
  API responses, JWT `email` claims, and outbound mail use the stored display
  email. Inputs are trimmed; no provider-specific alias rules (Gmail dots,
  plus-tags) are applied. See [Concepts](./concepts.md#the-security-model).

`POST /organizations/:id/switch` remains bearer-only with `{accessToken}`. It
requires current target membership and a valid future parent expiry, returning
`401` for missing/invalid expiry and `403` for membership denial. The derived
absolute `exp` never exceeds the parent, including recursive exchanges; A-to-B
exchange remains supported for members of B. It is not a renewal or session
introspection endpoint. Login/refresh/step-up issuance rules are unchanged.

Privileged JWT claims are intersected with primary role before ability construction
and all platform bypasses. `SystemRoles` additionally checks the original claim
and primary role against its exact required set. API keys operate as `USER` with
current explicit organization grants and scopes. An owner's platform role is
audit provenance; it never supplies a synthetic platform grant to the key.

Organization team administration is separately authorized by exact unrestricted
`manage:TeamAccess`, matching org context and live membership (the existing JWT
SUPER_ADMIN management exception remains). Keys need exact `manage:TeamAccess`;
limited org update grants cannot assign roles/permissions. Invitation and member-role
assignment routes are stricter: personal JWT plus actual membership and full
TeamAccess, without platform bypass or API-key admission. Org PATCH checks actual
pre/post records and all response fields transactionally; org DELETE additionally
requires delete on every scalar. Ordinary failures are 403 `FORBIDDEN`; positive-all
or partial TeamAccess permission assignments fail 400 validation. See [RBAC](rbac.md)
and the [installed-database upgrade](authorization-upgrade.md).

### Security-relevant response semantics

These behaviors are contracts, not incidental, and are easy to miss from shapes
alone:

- **Enumeration-safe responses.** `POST /auth/forgot-password`,
  `POST /auth/resend-verification` return the same success response whether or not
  the account/email exists. The org invite endpoint likewise uses the same `202`
  status and body for existing and unknown recipients; this does not promise
  constant-time execution or indistinguishable email delivery. See the
  [invitation contract](invites.md) for its precise limits.
- **Password admission (`POST /auth/login`)** returns 202 with a restricted
  continuation when further proof is required. A 202 response never contains
  an access token or refresh cookie. Private browser admission also returns
  this intermediate result for ordinary users, without a human MFA challenge.
  Independent ordinary API clients retain the 200 credential response.
  Protected accounts receive 503 in prepared deployments. See
  [password and publication transport](mfa-foundation.md#password-and-publication-transport)
  for publication acknowledgement and deployment requirements.
- **`POST /auth/logout` returns `204` without a legacy cookie.**
  Browser-bound credentials additionally require their actual private browser
  generation. Changed authority returns terminal `409 SESSION_CHANGED`, without
  falling back to legacy logout. See the [session authority](mfa-foundation.md#session-admission).
- **`POST /auth/reset-password` side effects:** the token is consumed atomically
  with the password update (single-use under concurrency), account security-version
  change and existing family/session revocation. Physical session cleanup and
  cache invalidation follow the commit and can fail after the change. The account email is
  marked **verified** (the reset proves mailbox control), and an
  `account.password_changed` security notification is emitted.
- **Step-up (`POST /auth/step-up`)** re-verifies the current password to refresh
  the session's recent-auth window, required before step-up-guarded admin
  operations once `STEP_UP_MAX_AGE_SECONDS` (default 10 min) has elapsed. It
  refreshes the existing session server-side — it does **not** create a session
  or rotate the refresh token, and a silent `POST /auth/refresh` does **not**
  refresh the window.
  Protected accounts can return `202` with
  `{ "kind": "proof_required", "requiredProofs": ["second_factor"] }` instead
  of a token. This verifies only the password; do not retry the sensitive action
  as though MFA were complete. Activation requires the separate [deployment procedure](mfa-deployment.md).

---

## Error format

All errors share a stable envelope:

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "errorCode": "INVALID_CREDENTIALS",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "path": "/api/v1/auth/login",
  "correlationId": "req_..."
}
```

Some carry `metadata` (e.g. `retryAfterSeconds` on a `429`). Validation failures
(`400`) carry per-field issues in an `errors[]` array; each entry has `field`,
`message`, an optional Zod `code`, and an optional project `errorCode` for custom
refinements such as the API-key scope grammar:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "scopes.1",
      "message": "Invalid input",
      "code": "custom",
      "errorCode": "API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN"
    }
  ]
}
```

**Localization:** translate by `errorCode` when present, else by the Zod `code`
for field issues. **`message` is diagnostic, not display text** — it is English,
written for developers, and may change between releases without notice;
`errorCode` is stable across API versions.

For an unrecognised code, show a generic localized message plus the
`correlationId` rather than falling through to `message`: the correlation ID is
what support needs to find the request, and rendering English developer prose to
a user is the failure this code contract exists to prevent. The bundled
`apps/web` follows exactly this rule — see
[`docs/frontend/architecture-and-conventions.md`](../frontend/architecture-and-conventions.md)
→ "API errors", where a test fails the build if a shared error code has no
translation.

A raw API consumer (a script, an integration, a log pipeline) may of course read
`message` for diagnostics — that is what it is for.

### Top-level error codes

Returned in the response root `errorCode`:

| Code                            | HTTP | Meaning                                                                                                                                |
| ------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `EMAIL_ALREADY_EXISTS`          | 409  | Registration: email already in use                                                                                                     |
| `REGISTRATION_SIGN_IN_REQUIRED` | 503  | Web BFF only, not the API: account created, sign-in unavailable                                                                        |
| `INVALID_CREDENTIALS`           | 401  | Login: wrong email or password                                                                                                         |
| `TOKEN_INVALID`                 | 400  | Reset/verify token expired, used, or not found                                                                                         |
| `RATE_LIMIT_EXCEEDED`           | 429  | Too many requests (login, reset, resend, API key, invitation accept)                                                                   |
| `SERVICE_UNAVAILABLE`           | 503  | A failure-protection counter could not be checked; repeat later                                                                        |
| `SESSION_NOT_FOUND`             | 404  | Refresh: no matching session                                                                                                           |
| `UNAUTHORIZED`                  | 401  | Missing or invalid JWT                                                                                                                 |
| `SESSION_CHANGED`               | 409  | Family, account version or actual browser authority changed; stop the operation without refresh fallback                               |
| `OAUTH_STATE_INVALID`           | 400  | OAuth: state expired or already consumed                                                                                               |
| `OAUTH_PROVIDER_ERROR`          | 502  | OAuth: provider returned an error                                                                                                      |
| `OAUTH_EMAIL_REQUIRED`          | 400  | OAuth: provider gave no email                                                                                                          |
| `OAUTH_PROVIDER_NOT_CONFIGURED` | 400  | OAuth: provider env vars missing                                                                                                       |
| `OAUTH_ACCOUNT_ALREADY_LINKED`  | 409  | Link: provider account belongs to another user                                                                                         |
| `OAUTH_TICKET_INVALID`          | 401  | OAuth: login ticket exchange failed                                                                                                    |
| `STEP_UP_REQUIRED`              | 403  | Sensitive action needs recent proof; legacy password step-up remains, while protected-account admission names `details.requiredProofs` |
| `STEP_UP_METHOD_UNAVAILABLE`    | 403  | Step-up impossible: OAuth-only account, no password                                                                                    |

### Invitation and signup errors

Invitation handlers use stable codes including `INVITE_ALREADY_PENDING`,
`INVITE_GENERATION_CONFLICT`, `INVITE_SETTLED`, `INVITE_ROLE_INTENT_INVALID`,
`INVITE_OPERATION_CONFLICT`, `INVITE_OPERATION_EXPIRED`,
`INVITE_ACCOUNT_MISMATCH`, `INVITE_FLOW_CHANGED` and `INVITE_FLOW_BUSY`.
Invalid credentials use the generic `INVITE_INVALID_OR_EXPIRED` where the
endpoint must conceal their state. Interpret these in the endpoint context;
see [invitation recovery](invites.md#recover-an-uncertain-outcome).

Closed ordinary signup returns `PUBLIC_SIGNUP_DISABLED`. Durable authentication
handoff uses `AUTH_HANDOFF_INVALID`, `AUTH_HANDOFF_ALREADY_STARTED` and
`AUTH_HANDOFF_CONFIRMED`. A lost response is not a rejection: observe current
state rather than repeat authentication. OpenAPI supplies endpoint status codes;
frontend catalogues map these codes to localized messages.

### API-key scope error codes

Returned per element in `errors[]` on `POST /api-keys` (on `errors[i].errorCode`,
not the top-level field). See [API Keys](./api-keys.md) for the scope grammar.

| Code                                 | HTTP | Meaning                                                 |
| ------------------------------------ | ---- | ------------------------------------------------------- |
| `API_KEY_SCOPE_INVALID_FORMAT`       | 400  | Not `action:Subject` shape                              |
| `API_KEY_SCOPE_UNKNOWN_ACTION`       | 400  | Action not in `{create, read, update, delete, manage}`  |
| `API_KEY_SCOPE_UNKNOWN_SUBJECT`      | 400  | Subject not in the shared `Subject` enum                |
| `API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN` | 400  | `manage:all` rejected — would grant unrestricted access |

---

## Environment variables

### Required

| Variable       | Description                                     |
| -------------- | ----------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string                    |
| `REDIS_URL`    | Redis connection string                         |
| `JWT_SECRET`   | Minimum 32 characters                           |
| `FRONTEND_URL` | e.g. `https://amcore.dev` — for OAuth redirects |

### Optional (with defaults)

| Variable                          | Default              | Description                                                                     |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| `AUTH_PUBLIC_SIGNUP_ENABLED`      | `true`               | Ordinary email/new-account OAuth signup; valid invited signup remains available |
| `JWT_ACCESS_EXPIRATION`           | `15m`                | Access-token lifetime                                                           |
| `JWT_REFRESH_DAYS`                | `7`                  | Refresh-token lifetime (days)                                                   |
| `PASSWORD_RESET_EXPIRY_MINUTES`   | `15`                 | Reset-link lifetime                                                             |
| `EMAIL_VERIFICATION_EXPIRY_HOURS` | `48`                 | Verification-link lifetime                                                      |
| `STEP_UP_MAX_AGE_SECONDS`         | `600`                | Recent-auth window for step-up-guarded ops                                      |
| `SUPPORT_EMAIL`                   | `support@amcore.com` | Support/contact address for transactional email                                 |

### MFA keyring

`MFA_ACTIVE_KEY_ID` and `MFA_ENCRYPTION_KEYS` have no defaults and do not activate
MFA. Prepared deployments can omit them. API/worker startup requires the current
key after protocol activation. The keyring is a secret
JSON mapping of IDs to base64-encoded 32-byte keys. See the
[foundation reference](mfa-foundation.md#encryption-configuration) for its scope.

### OAuth providers (all optional)

A provider is exposed via `GET /auth/oauth/providers` only if its required env
vars are set.

| Provider | Variables                                                                                     |
| -------- | --------------------------------------------------------------------------------------------- |
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`                             |
| GitHub   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`                             |
| Apple    | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CALLBACK_URL` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CALLBACK_URL`                                                 |

`RBAC_ACLV_CACHE_TTL_MS` is deprecated and ignored (default `0`; nonnegative
integers still validate). See [RBAC freshness and deployment](./rbac.md#freshness--caching).

## Password attempt protection

Login and password step-up can return429 with Retry-After 900 (pair block) or86400
(aggregate IP limit). Limiter storage/connection/capacity failure returns503 with
`SERVICE_UNAVAILABLE`; no new session or step-up token is issued. A dispatched
counter update may already have executed when its reply is lost. The limiter does
not replay it. See [brute-force protection](concepts.md#brute-force-protection).

API key authentication and invitation accept return the same `503` before any
credential or invitation work when their
[failure counters](concepts.md#api-key-and-invitation-failure-counters) cannot be checked.
