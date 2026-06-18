# API Reference

Complete list of all auth endpoints with parameters and responses.

**Base URL:** `https://api.example.com/api/v1` (replace with your deployment URL)

**Auth header:** `Authorization: Bearer {accessToken | amcore_live_...}`

JWT access tokens and API keys both ride on the same header — the server
disambiguates by token format. **Management routes** (`/api-keys/**`,
`/auth/sessions/**`) require a JWT specifically; API-key auth is rejected
with `401`.

**Email identity:** Email inputs are trimmed. Identity matching is
case-insensitive through the server-side canonical email key, while API
responses, JWT email claims, and outbound emails use the stored display email.

---

## Auth types per endpoint

| Symbol | Meaning                       |
| ------ | ----------------------------- |
| 🔓     | Public — no auth required     |
| 🔑     | JWT required                  |
| 🗝️     | JWT or API key                |
| 🍪     | Refresh token cookie required |

---

## Endpoints

### Registration & Login

#### `POST /auth/register` 🔓

| Field      | Type   | Required | Description                                 |
| ---------- | ------ | -------- | ------------------------------------------- |
| `email`    | string | ✅       | Valid email address; trimmed before storage |
| `password` | string | ✅       | Minimum 8 characters                        |
| `name`     | string | —        | Display name                                |

**Response** `200`:

```json
{ "user": UserObject, "accessToken": "eyJ..." }
```

Sets `refresh_token` cookie.

---

#### `POST /auth/login` 🔓

| Field      | Type   | Required |
| ---------- | ------ | -------- | -------------------------- |
| `email`    | string | ✅       | Matched case-insensitively |
| `password` | string | ✅       |

**Response** `200`:

```json
{ "user": UserObject, "accessToken": "eyJ..." }
```

Sets `refresh_token` cookie.

---

#### `POST /auth/logout` 🔓

No body. Reads `refresh_token` cookie.

**Response** `204` — always succeeds, even without a valid cookie.

---

#### `POST /auth/refresh` 🍪

No body. Reads `refresh_token` cookie.

**Response** `200`:

```json
{ "accessToken": "eyJ..." }
```

Rotates `refresh_token` cookie.

---

#### `GET /auth/me` 🗝️

No parameters. Accepts both JWT and API key — the canonical identity
self-check endpoint for integrations.

**Response** `200`: Full `UserObject`.

---

#### `POST /auth/step-up` 🔑

Re-verify the current password to refresh the **session's** recent-auth window
(OB-06b). Required before destructive admin operations guarded by step-up
(`PATCH /admin/users/:id`, `POST /admin/cleanup`) once the window has elapsed
(`STEP_UP_MAX_AGE_SECONDS`, default 10 min). Does **not** create a new session
or rotate the refresh token; a silent `POST /auth/refresh` does **not** refresh
this window.

```json
{ "password": "current-password" }
```

**Response** `200`: `{ "accessToken": "..." }` (the session is refreshed
server-side; the returned token simply carries the same session).
**Errors:** `401 INVALID_CREDENTIALS` (wrong password),
`403 STEP_UP_REQUIRED` (no/expired session — re-login),
`403 STEP_UP_METHOD_UNAVAILABLE` (OAuth-only account with no password).

---

### Sessions

#### `GET /auth/sessions` 🔑

Paginated list (ADR-036). Accepts the canonical `?page=N&limit=M` query
parameters (`1 ≤ page`, `1 ≤ limit ≤ 100`; defaults `page=1, limit=20`).

**Response** `200`:

```json
{
  "data": [
    {
      "id": "sess_...",
      "userAgent": "Mozilla/5.0...",
      "ipAddress": "192.168.1.1",
      "createdAt": "2024-03-20T10:00:00.000Z",
      "current": true
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

#### `DELETE /auth/sessions/:sessionId` 🔑

Revokes a specific session. Can only delete your own sessions.

**Response** `204`

---

#### `DELETE /auth/sessions` 🔑

Revokes all sessions except the current one.

**Response** `204`

---

### Password Reset

#### `POST /auth/forgot-password` 🔓

| Field   | Type   | Required |
| ------- | ------ | -------- |
| `email` | string | ✅       |

**Rate limit:** 3 requests per canonical email per hour.

**Response** `200` (always the same regardless of whether email exists):

```json
{ "message": "If an account with that email exists, a password reset link has been sent." }
```

---

#### `POST /auth/reset-password` 🔓

| Field      | Type   | Required | Description                |
| ---------- | ------ | -------- | -------------------------- |
| `token`    | string | ✅       | Token from the email link  |
| `password` | string | ✅       | New password (min 8 chars) |

**Response** `204`

Side effects: the token is consumed atomically (single-use, even under concurrent
requests); all sessions are revoked; the account email is marked **verified**
(the reset proves control of the mailbox); and a security notification
(`account.password_changed`, in-app + email) is emitted.

---

### Email Verification

#### `POST /auth/verify-email` 🔓

| Field   | Type   | Required |
| ------- | ------ | -------- |
| `token` | string | ✅       |

**Response** `204`

---

#### `POST /auth/resend-verification` 🔓

| Field   | Type   | Required |
| ------- | ------ | -------- |
| `email` | string | ✅       |

**Rate limit:** 3 requests per canonical email per hour.

**Response** `200`:

```json
{
  "message": "If the account exists and is not yet verified, a new verification email has been sent."
}
```

---

### OAuth

#### `GET /auth/oauth/providers` 🔓

**Response** `200`:

```json
{ "providers": ["google", "github", "apple", "telegram"] }
```

---

#### `GET /auth/oauth/:provider` 🔓

Redirects browser to the provider's consent screen.

Valid values for `:provider`: `google`, `github`, `apple`, `telegram`

**Response** `302 Redirect` → provider consent screen

---

#### `GET /auth/oauth/:provider/link` 🔑

Initiates account linking for an authenticated user.

**Response** `302 Redirect` → provider consent screen

---

#### `GET /auth/oauth/:provider/callback` 🔓

Called by the OAuth provider — not directly by your app.

Query params: `code`, `state` (both required)

On success: redirects to `{FRONTEND_URL}/auth/callback?ticket={ticket}` and sets `refresh_token` cookie.

On link success: redirects to `{FRONTEND_URL}/settings/linked-accounts?linked={provider}`.

---

#### `POST /auth/oauth/exchange` 🔓

Exchanges a one-time OAuth login ticket for an access token.

Requires `refresh_token` cookie from the OAuth callback.

**Body:**

```json
{
  "ticket": "one-time-ticket"
}
```

**Response** `200`:

```json
{
  "accessToken": "eyJhbGci..."
}
```

Invalid, expired, or already used tickets return the same `401` as invalid
refresh-cookie binding.

---

### API Keys

#### `POST /api-keys` 🔑

JWT required — API-key auth is rejected with `401`. See
[API Keys guide](./api-keys.md) for the full conceptual model.

| Field            | Type     | Required | Description                                            |
| ---------------- | -------- | -------- | ------------------------------------------------------ |
| `name`           | string   | ✅       | Human-readable label, 1–100 chars                      |
| `organizationId` | CUID     | ✅       | The org this key is bound to; creator must be a member |
| `scopes`         | string[] | ✅       | Canonical `action:Subject`; at least one element       |
| `expiresAt`      | ISO date | —        | Omit for no expiry                                     |

Scopes are validated against the `Action × Subject` registry; invalid
scopes return `400` with codes from the
[API Key Scope error codes](#api-key-scope-error-codes) table.

**Response** `201`:

```json
{
  "id": "cm1xyz...",
  "name": "CI Pipeline",
  "key": "amcore_live_a1B2c3D4e5F_x9Y8z7W6v5U4t3S2r1Q0p9O8n7M6l5K4",
  "organizationId": "cm1abc...",
  "scopes": ["read:User"],
  "expiresAt": null,
  "createdAt": "2026-05-16T10:00:00.000Z"
}
```

> The full `key` is only returned here. Save it immediately — the server
> stores a salted SHA-256 hash and cannot recover the raw value.

---

#### `GET /api-keys` 🔑

JWT required. Paginated list (ADR-036). Accepts `?page=N&limit=M`
(`1 ≤ page`, `1 ≤ limit ≤ 100`; defaults `page=1, limit=20`). No
secret fields in the response.

**Response** `200`:

```json
{
  "data": [
    {
      "id": "cm1xyz...",
      "name": "CI Pipeline",
      "organizationId": "cm1abc...",
      "scopes": ["read:User"],
      "expiresAt": null,
      "lastUsedAt": "2026-05-15T08:15:00.000Z",
      "createdAt": "2026-05-01T10:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

#### `DELETE /api-keys/:keyId` 🔑

JWT required. The key is immediately invalid.

**Response** `204`

---

## Data objects

### UserObject

```json
{
  "id": "cm1abc...",
  "email": "alex@example.com",
  "name": "Alex",
  "avatarUrl": "https://...",
  "phone": null,
  "emailVerified": true,
  "systemRole": "USER",
  "locale": "ru",
  "timezone": "Europe/Moscow",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "lastLoginAt": "2024-03-20T08:30:00.000Z"
}
```

---

## Error format

All errors follow this structure:

```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "errorCode": "INVALID_CREDENTIALS"
}
```

Some errors include extra context:

```json
{
  "statusCode": 429,
  "message": "Too many failed login attempts. Please try again in 15 minutes.",
  "errorCode": "RATE_LIMIT_EXCEEDED",
  "metadata": { "retryAfterSeconds": 900 }
}
```

Validation failures (`400`) carry per-field issues in an `errors` array.
Each entry has `field`, `message`, an optional Zod `code` (for built-in
checks), and an optional project-specific `errorCode` (for custom
refinements such as the API-key scope grammar):

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

Frontend localization should prefer `errorCode` when present, then
fall back to the generic `code`, then to `message`.

---

## Error codes

Use `errorCode` in your frontend for translations — it's stable across API versions. The `message` is in English and may change.

### Top-level error codes

Returned in the response root `errorCode`:

| Code                            | HTTP | Description                                                           |
| ------------------------------- | ---- | --------------------------------------------------------------------- |
| `EMAIL_ALREADY_EXISTS`          | 409  | Registration: email already in use                                    |
| `INVALID_CREDENTIALS`           | 401  | Login: wrong email or password                                        |
| `TOKEN_INVALID`                 | 400  | Reset/verify token: expired, used, or not found                       |
| `RATE_LIMIT_EXCEEDED`           | 429  | Too many requests (login, reset, resend)                              |
| `SESSION_NOT_FOUND`             | 404  | Refresh: no matching session in DB                                    |
| `UNAUTHORIZED`                  | 401  | Missing or invalid JWT                                                |
| `OAUTH_STATE_INVALID`           | 400  | OAuth: state param expired or already consumed                        |
| `OAUTH_PROVIDER_ERROR`          | 502  | OAuth: provider returned an error                                     |
| `OAUTH_EMAIL_REQUIRED`          | 400  | OAuth: provider gave no email, can't create user                      |
| `OAUTH_PROVIDER_NOT_CONFIGURED` | 400  | OAuth: missing env vars for this provider                             |
| `OAUTH_ACCOUNT_ALREADY_LINKED`  | 409  | Link: provider account belongs to another user                        |
| `OAUTH_TICKET_INVALID`          | 401  | OAuth: login ticket exchange failed                                   |
| `STEP_UP_REQUIRED`              | 403  | Destructive admin op needs recent re-auth — call `POST /auth/step-up` |
| `STEP_UP_METHOD_UNAVAILABLE`    | 403  | Step-up impossible: account has no password (OAuth-only)              |

### API Key Scope error codes

Returned per-element in the `errors[]` array on `POST /api-keys`. These
codes live on `errors[i].errorCode`, **not** the top-level `errorCode`
(which stays unset for validation failures).

| Code                                 | HTTP | Description                                               |
| ------------------------------------ | ---- | --------------------------------------------------------- |
| `API_KEY_SCOPE_INVALID_FORMAT`       | 400  | Not `action:Subject` shape (empty, no colon, extra parts) |
| `API_KEY_SCOPE_UNKNOWN_ACTION`       | 400  | Action not in `{create, read, update, delete, manage}`    |
| `API_KEY_SCOPE_UNKNOWN_SUBJECT`      | 400  | Subject not in the shared `Subject` enum                  |
| `API_KEY_SCOPE_MANAGE_ALL_FORBIDDEN` | 400  | `manage:all` rejected — would grant unrestricted access   |

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

| Variable                          | Default              | Description                                                          |
| --------------------------------- | -------------------- | -------------------------------------------------------------------- |
| `JWT_EXPIRATION`                  | `15m`                | Access token lifetime                                                |
| `JWT_REFRESH_DAYS`                | `7`                  | Refresh token lifetime in days                                       |
| `PASSWORD_RESET_EXPIRY_MINUTES`   | `15`                 | Reset link lifetime                                                  |
| `EMAIL_VERIFICATION_EXPIRY_HOURS` | `48`                 | Verification link lifetime                                           |
| `SUPPORT_EMAIL`                   | `support@amcore.com` | Operator support/contact address (available to transactional emails) |

### OAuth providers (all optional)

| Provider | Variables                                                                                     |
| -------- | --------------------------------------------------------------------------------------------- |
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`                             |
| GitHub   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`                             |
| Apple    | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CALLBACK_URL` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CALLBACK_URL`                                                 |

A provider is only exposed via `GET /auth/oauth/providers` if its required env vars are set.
