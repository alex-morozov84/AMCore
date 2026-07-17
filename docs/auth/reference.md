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

### Security-relevant response semantics

These behaviors are contracts, not incidental, and are easy to miss from shapes
alone:

- **Enumeration-safe responses.** `POST /auth/forgot-password`,
  `POST /auth/resend-verification`, and the org invite endpoint return the same
  success response whether or not the account/email exists — callers cannot probe
  for registered users.
- **`POST /auth/logout` always returns `204`,** even without a valid cookie.
- **`POST /auth/reset-password` side effects:** the token is consumed atomically
  (single-use under concurrency), all sessions are revoked, the account email is
  marked **verified** (the reset proves mailbox control), and an
  `account.password_changed` security notification is emitted.
- **Step-up (`POST /auth/step-up`)** re-verifies the current password to refresh
  the session's recent-auth window, required before step-up-guarded admin
  operations once `STEP_UP_MAX_AGE_SECONDS` (default 10 min) has elapsed. It
  refreshes the existing session server-side — it does **not** create a session
  or rotate the refresh token, and a silent `POST /auth/refresh` does **not**
  refresh the window.

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
      "message": "`manage:all` is forbidden — would grant unrestricted access",
      "code": "custom",
      "errorCode": "API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN"
    }
  ]
}
```

**Localization:** prefer `errorCode` when present, then `code`, then `message`.
`message` is English and may change; `errorCode` is stable across API versions.

### Top-level error codes

Returned in the response root `errorCode`:

| Code                            | HTTP | Meaning                                                               |
| ------------------------------- | ---- | --------------------------------------------------------------------- |
| `EMAIL_ALREADY_EXISTS`          | 409  | Registration: email already in use                                    |
| `INVALID_CREDENTIALS`           | 401  | Login: wrong email or password                                        |
| `TOKEN_INVALID`                 | 400  | Reset/verify token expired, used, or not found                        |
| `RATE_LIMIT_EXCEEDED`           | 429  | Too many requests (login, reset, resend)                              |
| `SESSION_NOT_FOUND`             | 404  | Refresh: no matching session                                          |
| `UNAUTHORIZED`                  | 401  | Missing or invalid JWT                                                |
| `OAUTH_STATE_INVALID`           | 400  | OAuth: state expired or already consumed                              |
| `OAUTH_PROVIDER_ERROR`          | 502  | OAuth: provider returned an error                                     |
| `OAUTH_EMAIL_REQUIRED`          | 400  | OAuth: provider gave no email                                         |
| `OAUTH_PROVIDER_NOT_CONFIGURED` | 400  | OAuth: provider env vars missing                                      |
| `OAUTH_ACCOUNT_ALREADY_LINKED`  | 409  | Link: provider account belongs to another user                        |
| `OAUTH_TICKET_INVALID`          | 401  | OAuth: login ticket exchange failed                                   |
| `STEP_UP_REQUIRED`              | 403  | Destructive admin op needs recent re-auth — call `POST /auth/step-up` |
| `STEP_UP_METHOD_UNAVAILABLE`    | 403  | Step-up impossible: OAuth-only account, no password                   |

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

| Variable                          | Default              | Description                                     |
| --------------------------------- | -------------------- | ----------------------------------------------- |
| `JWT_EXPIRATION`                  | `15m`                | Access-token lifetime                           |
| `JWT_REFRESH_DAYS`                | `7`                  | Refresh-token lifetime (days)                   |
| `PASSWORD_RESET_EXPIRY_MINUTES`   | `15`                 | Reset-link lifetime                             |
| `EMAIL_VERIFICATION_EXPIRY_HOURS` | `48`                 | Verification-link lifetime                      |
| `STEP_UP_MAX_AGE_SECONDS`         | `600`                | Recent-auth window for step-up-guarded ops      |
| `SUPPORT_EMAIL`                   | `support@amcore.com` | Support/contact address for transactional email |

### OAuth providers (all optional)

A provider is exposed via `GET /auth/oauth/providers` only if its required env
vars are set.

| Provider | Variables                                                                                     |
| -------- | --------------------------------------------------------------------------------------------- |
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`                             |
| GitHub   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`                             |
| Apple    | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CALLBACK_URL` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CALLBACK_URL`                                                 |

RBAC-specific tuning (`RBAC_ACLV_CACHE_TTL_MS`, Bull Board flags) is documented
where it applies — see [RBAC](./rbac.md#freshness--caching).
