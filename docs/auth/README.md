# Authentication & Authorization

AMCore uses a layered security system. At its core, it's straightforward: users prove who they are (authentication), and the system decides what they're allowed to do (authorization).

This guide covers everything — from "how do I log a user in" to "how do I restrict a button to org admins only."

---

## What's included

| Topic                           | What it covers                                                   |
| ------------------------------- | ---------------------------------------------------------------- |
| [Concepts](./concepts.md)       | How tokens, sessions, and the security model work                |
| [Email Auth](./email-auth.md)   | Register, login, password reset, email verification              |
| [OAuth](./oauth.md)             | Social login (Google, GitHub, Apple, Telegram) + account linking |
| [Sessions](./sessions.md)       | Managing active sessions, token rotation, multi-device           |
| [RBAC](./rbac.md)               | Roles, organizations, and permission checks                      |
| [API Keys](./api-keys.md)       | Machine-to-machine access with scoped keys                       |
| [API Reference](./reference.md) | All endpoints, parameters, and error codes                       |

---

## The 30-second mental model

```
Who are you?  →  Authentication  →  JWT access token (15 min)
                                     + refresh token in cookie (7 days)

What can you do?  →  Authorization  →  System role (USER / SUPER_ADMIN)
                                        + Organization roles (custom)
                                        + CASL permission rules
```

You send the access token with every request. When it expires, the refresh token silently gets you a new one — no re-login needed.

---

## Quick start

**1. Register a user**

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "alex@example.com", "password": "hunter2"}'
```

Response:

```json
{
  "user": { "id": "cm...", "email": "alex@example.com", "systemRole": "USER" },
  "accessToken": "eyJhbGci..."
}
```

A `refresh_token` cookie is also set automatically.

**2. Make an authenticated request**

```bash
curl https://api.amcore.dev/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGci..."
```

**3. Refresh the access token when it expires**

```bash
# The browser sends the refresh_token cookie automatically
curl -X POST https://api.amcore.dev/api/v1/auth/refresh \
  --cookie "refresh_token=..."
```

Response gives you a new `accessToken` and rotates the cookie.

---

## Authentication methods

The system supports three ways to authenticate a request:

| Method         | How                             | Use case                  |
| -------------- | ------------------------------- | ------------------------- |
| **JWT Bearer** | `Authorization: Bearer {token}` | Web/mobile apps, users    |
| **API Key**    | `X-API-Key: amk_...`            | Server-to-server, scripts |
| **None**       | No header                       | Public endpoints          |

Most endpoints accept both JWT and API key. Public endpoints (like `/auth/login`) require neither.

---

## Environments

| Variable           | Description                            |
| ------------------ | -------------------------------------- |
| `JWT_SECRET`       | Signs access tokens — keep this secret |
| `JWT_EXPIRATION`   | Access token lifetime (default: `15m`) |
| `JWT_REFRESH_DAYS` | Refresh token lifetime (default: `7`)  |
| `FRONTEND_URL`     | Where OAuth redirects land             |

See [API Reference](./reference.md#environment-variables) for the full list.
