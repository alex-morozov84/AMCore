# Email Authentication

Use the backend API to register, sign in, reset a password or verify an email.
Examples use fake values and example deployment hosts. Replace the hosts with your
API/frontend origins. Do not put real passwords, cookies or mail tokens in shared
terminal history, logs or reports.

This page documents the backend API contract at `/api/v1/auth/*`. The bundled
Next.js app (`apps/web`) calls same-origin BFF routes from the browser:
session-minting auth actions (`/api/auth/login`, `/api/auth/register`,
`/api/auth/logout`) keep backend tokens in the Redis session vault, while
public email-link actions (`/api/auth/forgot-password`,
`/api/auth/reset-password`, `/api/auth/verify-email`,
`/api/auth/resend-verification`) forward without minting a session; see
[Frontend architecture → Browser API reach](../frontend/architecture-and-conventions.md#browser-api-reach).

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
curl -X POST https://api.example.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -H "Accept-Language: en" \
  -d '{
    "email": "alex@example.com",
    "password": "ExamplePassword1",
    "name": "Alex",
    "locale": "en"
  }'
```

Registration passwords need at least 8 characters, one uppercase Latin letter
(`A–Z`), and one digit (`0–9`). The web registration form shows these
requirements below the password field before submission. The same rule and
hint apply when setting a new password through the reset flow below.

`locale` is optional and must be in `locales.json`'s enabled list (`en` and `ru` in the shipped build). It sets the new user's interface/email
language with this precedence:

1. an explicit `locale` in the body, else
2. the best supported match negotiated from the `Accept-Language` header, else
3. the configured `DEFAULT_LOCALE` from `locales.json`, written explicitly to the account.

An unsupported `Accept-Language` (e.g. `de`) falls through to the default; an
unsupported body `locale` is a `400` validation error.

**What happens:**

1. Email is trimmed and checked for canonical uniqueness — duplicate emails
   across case variants return `EMAIL_ALREADY_EXISTS`
2. Password is hashed with Argon2id
3. One database transaction creates the user (`systemRole: USER`,
   `emailVerified: false`, the resolved `locale`), its first session and its
   email-verification token. If the transaction fails, its writes roll back. When
   requests race for one canonical email, one wins and the others get
   `EMAIL_ALREADY_EXISTS`
4. After the commit, the welcome email is queued and the verification email is
   sent directly; see [queued email](../email/delivery.md#queued-email). A failed
   email never undoes the signup
5. A direct client receives the access token and `refresh_token` cookie.
   Browser registration additionally coordinates a pending publication; the BFF
   must finish publication before exposing an ordinary opaque app session

The transaction contains no Redis, email or other HTTP call. An error after the
commit, or a lost response, can hide a committed account: sign in or reset the
password instead of submitting the registration again. The web application adds
a session step; see
[registration results in the web application](../frontend/api-consumption.md#registration-results-in-the-web-application).

**Success response** `201 Created`:

```json
{
  "user": {
    "id": "cm1abc...",
    "email": "alex@example.com",
    "name": "Alex",
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
curl -X POST https://api.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alex@example.com",
    "password": "ExamplePassword1"
  }'
```

**What happens:**

1. Check both password-attempt limits and verify the credentials. See
   [brute-force protection](concepts.md#brute-force-protection).
2. An ordinary independent client completes sign-in, updates `lastLoginAt` and
   receives a new session and credentials. Other families remain active.
3. Browser admission and accounts requiring further proof return `202` with a
   restricted continuation, without an access token or refresh cookie. Ordinary
   browser users can receive this result without a human MFA challenge.
4. Complete the required proofs and exact publication before treating the user
   as signed in. Protected accounts return `503` while deployment is prepared.
   Follow [password and publication transport](mfa-foundation.md#password-and-publication-transport);
   do not fall back to an ordinary credential path.

**Completed ordinary independent-client response** `200 OK`:

```json
{
  "user": {
    "id": "cm1abc...",
    "email": "alex@example.com",
    "name": "Alex",
    "emailVerified": true
  },
  "accessToken": "eyJhbGci..."
}
```

**Errors:**

| Code                  | HTTP | When                                                             |
| --------------------- | ---- | ---------------------------------------------------------------- |
| `INVALID_CREDENTIALS` | 401  | Wrong email or password; same credential error message |
| `RATE_LIMIT_EXCEEDED` | 429  | Too many failed attempts                                         |

The shared error message avoids disclosing account existence through that message.
It does not promise constant-time execution or indistinguishable email delivery.
Protection/dependency failures can return `503`; a status alone is not proof
that a multi-step authentication operation completed.

---

## Logout

**Endpoint:** `POST /api/v1/auth/logout`

No authentication required — the refresh token cookie is used to identify and revoke the session.

```bash
curl -X POST https://api.example.com/api/v1/auth/logout \
  --cookie "refresh_token=..."
```

**What happens:**

1. Refresh token from the cookie is hashed and looked up
2. The matching session is deleted from the database
3. The cookie is cleared

A direct legacy call without a cookie returns `204`. Origin checks still apply.
Browser-bound logout requires the actual browser generation; changed authority
can return terminal `409 SESSION_CHANGED`. Dependency failure can also refuse
logout. Do not switch credentials or assume every logout response is successful.
See [logout semantics](reference.md#security-relevant-response-semantics).

**Success response:** `204 No Content`

---

## Password reset

This is a two-step flow: request a reset link, then use the link to set a new password.

### Step 1 — Request a reset link

**Endpoint:** `POST /api/v1/auth/forgot-password`

```bash
curl -X POST https://api.example.com/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "alex@example.com"}'
```

**What happens:**

1. The shared recipient/type budget is checked (three requests; each admitted
   request renews its one-hour expiry; refusals do not renew it)
2. If the email exists, a reset token is generated (32 random bytes, encoded as
   64 hexadecimal characters, then SHA-256 hashed for storage)
3. An email is sent with a link built by `localizedFrontendUrl()`. With several served locales,
   it is `https://app.example.com/{locale}/reset-password?token={raw_token}`. With one, it is
   `https://app.example.com/reset-password?token={raw_token}`. A stored locale no longer served
   falls back to the configured default; the link does not depend on a browser cookie
4. Token expires in **15 minutes**

SHA-256 stores a lookup key for the 256-bit random token, not a human password.
Password values use Argon2id. A slow password KDF is unnecessary for these random tokens;
changing their digest format would invalidate existing links.

**Successful response** `200 OK` (same body regardless of whether the email exists):

```json
{
  "message": "If an account with that email exists, a password reset link has been sent."
}
```

The same body avoids disclosing account existence through that response. It is
not a delivery receipt. Rate limits and dependency errors can still refuse the
request; an unknown outcome does not justify automatic resend.

**Rate limit:** Three requests per canonical email and email type. Each admitted
request renews the one-hour window; refusals do not extend it. Operator requests
use the same recipient budget. After that:
`429 Too Many Requests`.

---

### Step 2 — Set the new password

**Endpoint:** `POST /api/v1/auth/reset-password`

The frontend extracts the token from the URL and submits it with the new password:

```bash
curl -X POST https://api.example.com/api/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "a3f8b2...",
    "password": "NewExamplePassword1"
  }'
```

**What happens:**

1. Resolve the token and hash the new password outside the transaction.
2. Lock the user's mail-token operations and recheck the token, frontend binding
   and expiry against the current database clock after lock waits.
3. Consume the unused, unexpired token, update the password and `emailVerified`,
   advance the account security version and revoke existing families/sessions
   together in one transaction.
4. Delete revoked session rows after commit. The current user is read from
   the primary database; there is no profile-cache invalidation step.
5. Emit the password-changed notification best-effort.

**Success response:** `204 No Content`

**Errors:**

| Code            | HTTP | When                                      |
| --------------- | ---- | ----------------------------------------- |
| `TOKEN_INVALID` | 401  | Token not found, already used, or expired |

### Completion and session failures

Physical session cleanup follows the security transaction.
If it fails, the endpoint can return an error although the password changed
and the link was consumed. Revoked session rows can remain when cleanup fails;
this does not restore revoked authority.
Notification failure alone does not
reject the committed reset. There is no automatic replay of these follow-ups.

Try normal sign-in with the chosen password. Do not repeatedly reuse the consumed
link. Inspect and revoke sessions through Settings or an authorized administrator
when needed. Browser and protected-account credentials fail their next authority
check, even
if physical cleanup fails. Only never-protected independent API clients retain
the residual lifetime of already issued access JWTs. Future refresh is refused.
A mail-send result proves none of these
recipient completion effects.

---

## Email verification

Email verification is sent automatically on registration. Users can also request it again if they missed it.

### Verify the email

**Endpoint:** `POST /api/v1/auth/verify-email`

The frontend extracts the token from the link and sends it:

```bash
curl -X POST https://api.example.com/api/v1/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"token": "b7c9a1..."}'
```

**What happens:**

1. Token is hashed and looked up
2. Expiry is checked (48-hour window)
3. Under the common user mail-token lock, conditionally consume the unused,
   unexpired token and set `emailVerified` together in one transaction
4. The next request reads the updated user from the database (there is no user cache)

**Success response:** `204 No Content`

**Errors:**

| Code            | HTTP | When                                      |
| --------------- | ---- | ----------------------------------------- |
| `TOKEN_INVALID` | 401  | Token not found, already used, or expired |

---

### Resend the verification email

**Endpoint:** `POST /api/v1/auth/resend-verification`

```bash
curl -X POST https://api.example.com/api/v1/auth/resend-verification \
  -H "Content-Type: application/json" \
  -d '{"email": "alex@example.com"}'
```

**Successful response** `200 OK` (same body for existing, absent and already verified accounts):

```json
{
  "message": "If the account exists and is not yet verified, a new verification email has been sent."
}
```

**Rate limit:** Three requests per canonical email and email type. Each admitted
request renews the one-hour window; refusals do not extend it. Operator requests
use the same recipient budget.

---

## Getting the current user

**Endpoint:** `GET /api/v1/auth/me`

```bash
curl https://api.example.com/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGci..."
```

**Success response** `200 OK` (the user is wrapped in a `user` envelope):

```json
{
  "user": {
    "id": "cm1abc...",
    "email": "alex@example.com",
    "name": "Alex",
    "avatarUrl": null,
    "phone": null,
    "emailVerified": true,
    "locale": "en",
    "timezone": "UTC",
    "createdAt": "2024-01-15T10:00:00.000Z",
    "lastLoginAt": "2024-03-20T08:30:00.000Z"
  }
}
```

`GET /auth/me` accepts both a Bearer JWT and an API key (it is the identity
self-check endpoint). Updating the profile is Bearer-only — see below.

---

## Updating the current user

**Endpoint:** `PATCH /api/v1/auth/me` (Bearer JWT only)

```bash
curl -X PATCH https://api.example.com/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGci..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alexander",
    "locale": "en",
    "timezone": "America/New_York"
  }'
```

All fields are optional; only the fields you send are changed. This is the
authoritative way to set a stored language preference — once set, it always
wins over `Accept-Language`.

| Field      | Rules                                    |
| ---------- | ---------------------------------------- |
| `name`     | ≥ 2 characters                           |
| `locale`   | A locale enabled in `locales.json`       |
| `timezone` | a valid IANA zone (e.g. `Europe/Moscow`) |

**Success response** `200 OK`: the full updated profile in the same `{ user }`
envelope as `GET /auth/me`.

**Errors:**

| Code             | HTTP | When                                             |
| ---------------- | ---- | ------------------------------------------------ |
| validation error | 400  | Unsupported `locale` or invalid `timezone`       |
| `UNAUTHORIZED`   | 401  | Missing/invalid Bearer token (API keys rejected) |

## Registration policy and invitations

`AUTH_PUBLIC_SIGNUP_ENABLED` defaults to `true`. Set it to `false` to disable
ordinary email registration; existing accounts can still sign in. The API enforces
this policy regardless of visible links. `GET /auth/signup-policy` returns the
public projection used by application registration screens. OAuth new-account
creation follows the same policy.

A valid [organization invitation](invites.md#scoped-signup-and-authentication)
permits registration for its fixed email even when public signup is closed.
The account is unverified and has no organization membership until explicit
acceptance after verification. If registration succeeds but its response is lost,
use sign-in or password reset; do not automatically resubmit the password.

An ordinary verification email opened in a new tab contains no invitation-flow
selector. Return to the invitation tab and refresh current identity, or reopen
the original invitation. Password reset preserves all-session revocation; sign
in again and reopen rather than transferring invitation authority through reset.

## Shared issuance and upgrade

Registration, invited registration, public recovery/resend and privileged support
mail use the same per-user database lock. New issuance cancels earlier unused
links of the same type. Verification and password-reset links remain independent.
Final consumption checks current database time in its conditional write, including
a wait for a token row. Public responses remain enumeration-safe; public passwordless
recovery still lets the mailbox owner establish a password.

Before upgrading existing installations, stop and drain every old API writer
that can request auth email. Apply the migration, then start the new version.
Do not run old and new writers together: old cache counters cannot participate
in the new atomic budget. The new limiter imports the legacy counter (a
`{"value":N,"expires":ms}` envelope under the old key) and its remaining Redis TTL
on first reservation without granting a second budget. Unknown or malformed live data refuses safely. Admitted requests
renew the new recipient counter for one hour; denied requests retain its expiry.

For rollback, stop/drain new writers first. Retain the database migration and
wait at least one full hour with auth-mail requests stopped before starting old
writers. That avoids resetting a live new-version quota through an old namespace.
Do not delete counters to bypass refusal. Redis unavailability refuses auth-mail
requests; there is no in-memory fallback or automatic send retry.
