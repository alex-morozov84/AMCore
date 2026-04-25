# Email Authentication

Standard username/password auth — register, log in, reset your password, verify your email.

---

## Email identity policy

AMCore treats email identity as case-insensitive. Incoming auth emails are
trimmed, stored as the user-facing `email`, and compared through a separate
canonical key.

- `email` is the display/contact address returned in API responses, JWT claims,
  and used for outbound email.
- `emailCanonical` is the internal identity key used for uniqueness, login,
  recovery, verification resend, OAuth linking, organization member lookup, and
  email-scoped rate limits.
- Provider-specific aliases are not normalized. `alex+tag@example.com` and
  `alex@example.com` are different identities; Gmail dot removal is not applied.

---

## Registration

**Endpoint:** `POST /api/v1/auth/register`

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alex@example.com",
    "password": "my-secure-password",
    "name": "Alex"
  }'
```

**What happens:**

1. Email is trimmed and checked for canonical uniqueness — duplicate emails
   across case variants return `EMAIL_ALREADY_EXISTS`
2. Password is hashed with Argon2id (~100ms intentionally)
3. A new user is created with `systemRole: USER` and `emailVerified: false`
4. A verification email is queued (non-blocking — registration succeeds regardless)
5. A session is created, tokens are issued

**Success response** `200 OK`:

```json
{
  "user": {
    "id": "cm1abc...",
    "email": "alex@example.com",
    "name": "Alex",
    "systemRole": "USER",
    "emailVerified": false
  },
  "accessToken": "eyJhbGci..."
}
```

The `refresh_token` cookie is set automatically.

**Errors:**

| Code                   | HTTP | When                             |
| ---------------------- | ---- | -------------------------------- |
| `EMAIL_ALREADY_EXISTS` | 409  | This email is already registered |

---

## Login

**Endpoint:** `POST /api/v1/auth/login`

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alex@example.com",
    "password": "my-secure-password"
  }'
```

**What happens:**

1. Rate limit is checked (5 failed attempts per canonical email+IP per hour)
2. User is looked up by canonical email
3. Password is verified against the Argon2 hash
4. `lastLoginAt` is updated
5. A new session is created (previous sessions on other devices remain active)
6. Tokens are issued

**Success response** `200 OK`:

```json
{
  "user": {
    "id": "cm1abc...",
    "email": "alex@example.com",
    "name": "Alex",
    "systemRole": "USER",
    "emailVerified": true
  },
  "accessToken": "eyJhbGci..."
}
```

**Errors:**

| Code                  | HTTP | When                                                             |
| --------------------- | ---- | ---------------------------------------------------------------- |
| `INVALID_CREDENTIALS` | 401  | Wrong email or password (same message for both — no enumeration) |
| `RATE_LIMIT_EXCEEDED` | 429  | Too many failed attempts                                         |

> **Note:** The error message is intentionally vague — "Invalid credentials" rather than "Wrong password" or "Email not found." This prevents attackers from discovering which emails are registered.

---

## Logout

**Endpoint:** `POST /api/v1/auth/logout`

No authentication required — the refresh token cookie is used to identify and revoke the session.

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/logout \
  --cookie "refresh_token=..."
```

**What happens:**

1. Refresh token from the cookie is hashed and looked up
2. The matching session is deleted from the database
3. The cookie is cleared

If no valid refresh token is provided, the endpoint still returns `204` — logout is always safe to call.

**Success response:** `204 No Content`

---

## Password reset

This is a two-step flow: request a reset link, then use the link to set a new password.

### Step 1 — Request a reset link

**Endpoint:** `POST /api/v1/auth/forgot-password`

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "alex@example.com"}'
```

**What happens:**

1. Rate limit is checked (3 requests per canonical email per hour)
2. If the email exists, a reset token is generated (64 random bytes, SHA-256 hashed for storage)
3. An email is sent with a link: `https://amcore.dev/reset-password?token={raw_token}`
4. Token expires in **15 minutes**

**Success response** `200 OK` (always the same, regardless of whether the email exists):

```json
{
  "message": "If an account with that email exists, a password reset link has been sent."
}
```

> **Why the same response?** If we returned different messages for existing vs non-existing emails, an attacker could use this endpoint to find out which emails are registered. The vague response protects your users' privacy.

**Rate limit:** 3 requests per canonical email per hour. After that:
`429 Too Many Requests`.

---

### Step 2 — Set the new password

**Endpoint:** `POST /api/v1/auth/reset-password`

The frontend extracts the token from the URL and submits it with the new password:

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "a3f8b2...",
    "password": "my-new-secure-password"
  }'
```

**What happens:**

1. Token is hashed (SHA-256) and looked up in the database
2. Expiry is checked (15-minute window)
3. Token is marked as used — it cannot be reused
4. New password is hashed with Argon2id
5. **All existing sessions are revoked** — every device is signed out
6. A "password changed" confirmation email is sent

**Success response:** `204 No Content`

**Errors:**

| Code            | HTTP | When                                      |
| --------------- | ---- | ----------------------------------------- |
| `TOKEN_INVALID` | 400  | Token not found, already used, or expired |

> **Important:** After a successful reset, the user must log in again on all devices. This is intentional — if the reset was triggered by an attacker, this signs them out.

---

## Email verification

Email verification is sent automatically on registration. Users can also request it again if they missed it.

### Verify the email

**Endpoint:** `POST /api/v1/auth/verify-email`

The frontend extracts the token from the link and sends it:

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"token": "b7c9a1..."}'
```

**What happens:**

1. Token is hashed and looked up
2. Expiry is checked (48-hour window)
3. Token is marked as used
4. `emailVerified` is set to `true`
5. User cache is cleared so the next request reflects the change

**Success response:** `204 No Content`

**Errors:**

| Code            | HTTP | When                                      |
| --------------- | ---- | ----------------------------------------- |
| `TOKEN_INVALID` | 400  | Token not found, already used, or expired |

---

### Resend the verification email

**Endpoint:** `POST /api/v1/auth/resend-verification`

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/resend-verification \
  -H "Content-Type: application/json" \
  -d '{"email": "alex@example.com"}'
```

**Success response** `200 OK` (always the same):

```json
{
  "message": "If the account exists and is not yet verified, a new verification email has been sent."
}
```

**Rate limit:** 3 requests per canonical email per hour.

---

## Getting the current user

**Endpoint:** `GET /api/v1/auth/me`

```bash
curl https://api.amcore.dev/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGci..."
```

**Success response** `200 OK`:

```json
{
  "id": "cm1abc...",
  "email": "alex@example.com",
  "name": "Alex",
  "avatarUrl": null,
  "phone": null,
  "emailVerified": true,
  "systemRole": "USER",
  "locale": "ru",
  "timezone": "Europe/Moscow",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "lastLoginAt": "2024-03-20T08:30:00.000Z"
}
```
