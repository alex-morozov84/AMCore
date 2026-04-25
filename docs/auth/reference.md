# API Reference

Complete list of all auth endpoints with parameters and responses.

**Base URL:** `https://api.amcore.dev/api/v1`

**Auth header:** `Authorization: Bearer {accessToken}`
**API key header:** `X-API-Key: {key}`

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

#### `GET /auth/me` 🔑

No parameters.

**Response** `200`: Full `UserObject`.

---

### Sessions

#### `GET /auth/sessions` 🔑

**Response** `200`:

```json
{
  "sessions": [
    {
      "id": "sess_...",
      "userAgent": "Mozilla/5.0...",
      "ipAddress": "192.168.1.1",
      "createdAt": "2024-03-20T10:00:00.000Z",
      "current": true
    }
  ]
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

Side effects: All sessions revoked.

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

| Field       | Type     | Required | Description                               |
| ----------- | -------- | -------- | ----------------------------------------- |
| `name`      | string   | ✅       | Human-readable label                      |
| `scopes`    | string[] | ✅       | e.g. `["read:Contact", "create:Contact"]` |
| `expiresAt` | ISO date | —        | Omit for no expiry                        |

**Response** `201`:

```json
{
  "id": "key_...",
  "name": "CI Pipeline",
  "token": "amk_...",
  "shortToken": "amk_a1**",
  "scopes": ["read:Contact"],
  "expiresAt": null,
  "createdAt": "..."
}
```

> The full `token` is only returned here. Save it immediately.

---

#### `GET /api-keys` 🔑

**Response** `200`:

```json
{ "apiKeys": [ApiKeyObject, ...] }
```

---

#### `DELETE /api-keys/:keyId` 🔑

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

---

## Error codes

Use `errorCode` in your frontend for translations — it's stable across API versions. The `message` is in English and may change.

| Code                            | HTTP | Description                                      |
| ------------------------------- | ---- | ------------------------------------------------ |
| `EMAIL_ALREADY_EXISTS`          | 409  | Registration: email already in use               |
| `INVALID_CREDENTIALS`           | 401  | Login: wrong email or password                   |
| `TOKEN_INVALID`                 | 400  | Reset/verify token: expired, used, or not found  |
| `RATE_LIMIT_EXCEEDED`           | 429  | Too many requests (login, reset, resend)         |
| `SESSION_NOT_FOUND`             | 404  | Refresh: no matching session in DB               |
| `UNAUTHORIZED`                  | 401  | Missing or invalid JWT                           |
| `OAUTH_STATE_INVALID`           | 400  | OAuth: state param expired or already consumed   |
| `OAUTH_PROVIDER_ERROR`          | 502  | OAuth: provider returned an error                |
| `OAUTH_EMAIL_REQUIRED`          | 400  | OAuth: provider gave no email, can't create user |
| `OAUTH_PROVIDER_NOT_CONFIGURED` | 400  | OAuth: missing env vars for this provider        |
| `OAUTH_ACCOUNT_ALREADY_LINKED`  | 409  | Link: provider account belongs to another user   |
| `OAUTH_TICKET_INVALID`          | 401  | OAuth: login ticket exchange failed              |

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

| Variable                          | Default | Description                    |
| --------------------------------- | ------- | ------------------------------ |
| `JWT_EXPIRATION`                  | `15m`   | Access token lifetime          |
| `JWT_REFRESH_DAYS`                | `7`     | Refresh token lifetime in days |
| `PASSWORD_RESET_EXPIRY_MINUTES`   | `15`    | Reset link lifetime            |
| `EMAIL_VERIFICATION_EXPIRY_HOURS` | `48`    | Verification link lifetime     |
| `SUPPORT_EMAIL`                   | —       | Shown in transactional emails  |

### OAuth providers (all optional)

| Provider | Variables                                                                                     |
| -------- | --------------------------------------------------------------------------------------------- |
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`                             |
| GitHub   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`                             |
| Apple    | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CALLBACK_URL` |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CALLBACK_URL`                                                 |

A provider is only exposed via `GET /auth/oauth/providers` if its required env vars are set.
