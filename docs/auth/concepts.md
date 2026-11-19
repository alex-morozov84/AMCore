# Core Concepts

Read this explanation before integrating direct API credentials or choosing
between API and bundled browser sessions. Procedures live in the linked guides.

---

## Two kinds of tokens

The system uses two tokens that work together. They serve completely different purposes.

### Access token (JWT)

The access token is a short-lived signed credential (default 15 minutes). After signature validation, AMCore also resolves the current
user from the primary database. This is the same read that checks the session's
authority, so a request costs one user read and no Redis call for this step.

```
eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjbTEyMyIsImVtYWlsIjoiYWxleEBleGFtcGxlLmNvbSIsInN5c3RlbVJvbGUiOiJVU0VSIn0.signature
```

Decoded, it looks like:

```json
{
  "sub": "cm123",
  "email": "alex@example.com",
  "systemRole": "USER",
  "organizationId": "org456",
  "aclVersion": 3,
  "iat": 1706000000,
  "exp": 1706000900
}
```

The token carries the signed claims, while the user lookup rejects tokens whose
user no longer exists. Every privileged JWT claim also requires a primary-role
check before authorization; the user lookup only proves the account exists.
Organization `/switch` derives a token bounded by its parent's expiry and cannot
renew access, including through repeated exchanges. See [RBAC](./rbac.md).

### Refresh token (opaque)

A refresh token obtains new credentials. Each issued token expires after
`JWT_REFRESH_DAYS` (default 7 days); a successful rotation starts a new token lifetime.
Direct API clients receive an httpOnly refresh cookie. AMCore web instead keeps
the refresh token in its server-side Redis vault; the browser receives an opaque
session cookie and never receives the backend token in JavaScript.

Successful refresh replaces the old token. This is **token rotation**.
Reusing a retained rotated token revokes its whole family, including the new token.
Rotation does not prevent use of a stolen token before the legitimate client rotates it.

The API stores a SHA-256 hash of the refresh token in SQL. The web vault stores
the raw token in Redis. Redis persistence and backups can therefore contain vault
credentials; protect their access and storage accordingly.

---

## Sessions

A session family represents one completed sign-in, not a verified device.
A restricted login continuation does not yet grant an ordinary session:

```
User "alex"
├── Session 1 — Chrome on MacBook (created 2 days ago)
├── Session 2 — Safari on iPhone (created today)
└── Session 3 — Firefox on Work PC (created last week)
```

Each session has its own refresh token. Logging out on one device doesn't affect the others. A user can view and revoke sessions from their account settings.

Password reset revokes existing families and advances account authority atomically.
Physical row cleanup follows. Browser and protected credentials fail their next
authority check; only never-protected independent clients retain issued JWT expiry.
See [reset completion failures](./email-auth.md#completion-and-session-failures).

---

## The token lifecycle

This is `apps/api`'s own contract, for a direct API consumer (mobile app,
script, or a custom frontend talking to the backend itself). The bundled
`apps/web` frontend does **not** work this way — see
[README → The 30-second mental model](./README.md#the-30-second-mental-model)
for why: the browser uses an opaque BFF session cookie; backend tokens stay
server-side. The temporary OAuth handoff contains a nonce, not either backend token.

```
COMPLETED LOGIN (an intermediate 202 is not completion)
  │
  ▼
Backend creates:
  ├── access token  (JWT, 15 min) ──────────► stored in app memory
  └── refresh token (random, 7 days) ────────► stored in httpOnly cookie

  Every API request:
  Authorization: Bearer {access token}

  After 15 minutes → 401 Unauthorized
  │
  ▼
POST /auth/refresh  (cookie sent automatically)
  │
  ▼
Backend:
  ├── validates refresh token against DB
  ├── revokes old refresh token
  └── issues new access token + new refresh token (rotation)

  After refresh-token expiry or refusal → sign in again
```

---

## The security model

**Authentication** answers: "Who are you?"

| Method           | Mechanism                                     |
| ---------------- | --------------------------------------------- |
| Email + password | Argon2id password hash                        |
| OAuth            | Provider identity verified via OIDC/OAuth 2.0 |
| API key          | Scoped token, hashed in DB                    |

Email identity is case-insensitive inside AMCore. The original trimmed email is
preserved as the display/contact address, while `emailCanonical` is the unique
identity key used by auth, OAuth linking, account recovery, verification resend,
organization member lookup, and email-scoped rate limits. AMCore does not apply
provider-specific alias rules such as Gmail dot removal or plus-tag stripping.

**Authorization** answers: "What can you do?"

There are two independent layers:

**1. System role** — applies everywhere, regardless of organization.

| Role          | What it means                                                |
| ------------- | ------------------------------------------------------------ |
| `USER`        | Normal user, default for everyone                            |
| `SUPER_ADMIN` | Platform role, subject to route and current-authority checks |

**2. Organization permissions** — fine-grained rules within an org context (see [RBAC](./rbac.md)).

These two layers are checked independently. A user needs to pass both.

---

## Passwords

AMCore hashes passwords with **Argon2id**. Use HTTPS when submitting a password.
Keep passwords out of logs, telemetry and stored request bodies; a hash does not
protect a password exposed before hashing.

Users who signed up via OAuth don't have a password — they can set one later through account settings.

---

## Brute-force protection

The login endpoint is rate-limited at two levels simultaneously:

| Limit                    | Threshold           | Window   | Penalty      |
| ------------------------ | ------------------- | -------- | ------------ |
| Per IP                   | 100 failed attempts | 24 hours | Blocked      |
| Per canonical email + IP | 5 failed attempts   | 1 hour   | 15-min block |

The combination matters: the per-IP limit catches credential stuffing (many accounts, one IP), while the per-canonical-email+IP limit catches targeted attacks on a specific account.

Login and password step-up use the peer-verified visitor IP when configured,
then `req.ip`/socket fallback. A successful password clears only that email+IP
counter and block. It preserves the aggregate IP count and its remaining expiry.
A correct password does not bypass an already reached IP limit. Once the
aggregate reaches 100, subsequent checks refuse until that key expires 24 hours
after its last recorded failure. Retry-After 86400 is a constant refusal hint,
not a measurement of the key's remaining lifetime. Already admitted failures
can still finish and renew that window.

Each Redis check, failure update and pair/block reset executes atomically.
Concurrent recorded failures do not lose increments. The windows renew on failure;
check and success do not renew the aggregate window. Already admitted password
checks may finish after another request reaches the limit; there is no reservation
cap on in-flight checks. Shared NAT users share an IP budget.

If protection is unavailable, the API returns503/SERVICE_UNAVAILABLE without issuing
a new session or step-up token. A timeout after sending a Redis command can leave
its effect unknown. The limiter never retries that command or clears counters to
hide uncertainty. See the [coordinated upgrade](../operations/deployment.md#password-limiter-upgrade-and-rollback).

### API key and invitation failure counters

API key verification and invitation accept keep two failure counters in Redis: one per
source address and one per credential fingerprint. The fingerprint is a truncated hash;
the credential itself is never stored or logged.

| Counter                    | Limit               | Expires                       |
| -------------------------- | ------------------- | ----------------------------- |
| Per source address         | 100 failed attempts | 1 hour after the last failure |
| Per credential fingerprint | 20 failed attempts  | 1 hour after the last failure |

- A request over either limit returns `429` with `RATE_LIMIT_EXCEEDED` and
  `retryAfterSeconds: 3600`, before any database work.
- One atomic Redis script updates both counters, so concurrent failures do not lose
  increments. A valid credential clears only its fingerprint counter and keeps the
  source-address counter.
- The limit does not reserve capacity. Requests that passed the check can finish after
  another request reaches the limit.
- If a counter cannot be read, the request fails closed: `503` with
  `SERVICE_UNAVAILABLE`, before any credential or invitation work. It is safe to
  repeat the request after a short delay.
- If recording a failed attempt fails, an API key request also returns `503`. An
  invitation keeps its original error, and that attempt may not be counted. A
  timeout after the command was sent leaves the effect unknown, and the API never
  repeats it.
- A value that is not a canonical integer under a counter key is an error, never
  zero. The API logs `abuse_counter.check_failed`, `abuse_counter.record_failed` or
  `abuse_counter.reset_failed` with the case (`not_sent` or `unknown`) and the
  fingerprint.
- Counters need one Redis server. The two keys are not guaranteed to share a cluster slot.
- These Redis calls wait at most a fixed deadline (`BOUNDED_REDIS_DEADLINE_MS`). The
  deadline limits how long a caller waits. It does not cancel a command that was
  already sent. They run on the supervised authentication Redis client, not on the
  shared one.
- Each generation of that client holds at most `BOUNDED_REDIS_CAPACITY` unsettled calls. A
  call keeps its slot until its reply arrives or the connection errors or closes, even
  after the caller gave up. When all slots are held, new calls are refused at once
  (`503`, and nothing was sent). A client that stops answering is replaced; see
  [authentication when Redis is slow or unavailable](redis-outage.md) for the triggers
  and recovery targets and their limits.
- A clear that timed out can still run later and remove fingerprint failures
  recorded in the meantime. The source-address counter is never cleared by it.

---

## What "verified email" means

`emailVerified: false` does not by itself block ordinary sign-in. It is not a
universal permission: invitation acceptance and protected-account setup can
require verified email. Follow the owning journey rather than treating login as verification.

Verification tokens are single-use and expire after `EMAIL_VERIFICATION_EXPIRY_HOURS`
(default 48 hours).

---

## Cookies and CORS

The refresh token lives in a cookie with these flags:

| Flag       | Value                | Why                                         |
| ---------- | -------------------- | ------------------------------------------- |
| `httpOnly` | `true`               | JavaScript cannot directly read this cookie |
| `secure`   | `true` in production | Only sent over HTTPS                        |
| `sameSite` | `strict`             | Primary CSRF layer for the refresh cookie   |
| `path`     | `/`                  | Available to all paths                      |
| `maxAge`   | 7 days               | Browser discards it after this              |

A custom browser client should keep access tokens out of persistent browser storage.
Bundled web clients keep them server-side, not in browser memory.

This cookie table describes `apps/api`'s own `refresh_token` cookie for a
direct API consumer. `apps/web` additionally sets its own `amcore_session`
cookie on its own origin — see
[Sessions → How sessions work](./sessions.md#how-sessions-work) — and keeps backend tokens server-side.
The brief OAuth callback nonce is the exception to ordinary cookie routing;
it is not a refresh credential.

See [CSRF Posture](./csrf.md) for the cookie-surface policy, the
Origin/Referer second layer, and the frontend-agnostic rationale for allow-on-missing.
