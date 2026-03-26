# Core Concepts

Before diving into specific flows, here's how the pieces fit together. You don't need to memorize this — come back when something doesn't make sense.

---

## Two kinds of tokens

The system uses two tokens that work together. They serve completely different purposes.

### Access token (JWT)

Think of it as a **day pass**. It's short-lived (15 minutes), self-contained, and fast to verify — the server doesn't need to touch the database to validate it.

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

The server trusts this token if the signature is valid — no database lookup. That's what makes it fast.

### Refresh token (opaque)

Think of it as a **membership card**. It's long-lived (7 days), stored in an `httpOnly` cookie (invisible to JavaScript), and the only thing it can do is get you a new access token.

When you use it, the old one is immediately destroyed and a new one is issued. This is called **token rotation** — if someone steals an old refresh token, it's already worthless.

The server stores a SHA-256 hash of your refresh token in the database. The raw token never touches disk.

---

## Sessions

A session represents one logged-in device. Every login creates a new session:

```
User "alex"
├── Session 1 — Chrome on MacBook (created 2 days ago)
├── Session 2 — Safari on iPhone (created today)
└── Session 3 — Firefox on Work PC (created last week)
```

Each session has its own refresh token. Logging out on one device doesn't affect the others. A user can view and revoke sessions from their account settings.

When a password is reset, **all sessions are destroyed** — every device gets signed out.

---

## The token lifecycle

```
LOGIN
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
  ├── destroys old refresh token
  └── issues new access token + new refresh token (rotation)

  After 7 days → must log in again
```

---

## The security model

**Authentication** answers: "Who are you?"

| Method           | Mechanism                                     |
| ---------------- | --------------------------------------------- |
| Email + password | Argon2id hash (64 MB memory, 3 iterations)    |
| OAuth            | Provider identity verified via OIDC/OAuth 2.0 |
| API key          | Scoped token, hashed in DB                    |

**Authorization** answers: "What can you do?"

There are two independent layers:

**1. System role** — applies everywhere, regardless of organization.

| Role          | What it means                         |
| ------------- | ------------------------------------- |
| `USER`        | Normal user, default for everyone     |
| `SUPER_ADMIN` | Full platform access, can do anything |

**2. Organization permissions** — fine-grained rules within an org context (see [RBAC](./rbac.md)).

These two layers are checked independently. A user needs to pass both.

---

## Passwords

Passwords are hashed with **Argon2id** — currently the gold standard for password hashing. The parameters (64 MB memory cost, 3 time cost) make brute-force attacks impractical even with specialized hardware.

The raw password is never stored, logged, or transmitted after the initial request.

Users who signed up via OAuth don't have a password — they can set one later through account settings.

---

## Brute-force protection

The login endpoint is rate-limited at two levels simultaneously:

| Limit          | Threshold           | Window   | Penalty      |
| -------------- | ------------------- | -------- | ------------ |
| Per IP         | 100 failed attempts | 24 hours | Blocked      |
| Per email + IP | 5 failed attempts   | 1 hour   | 15-min block |

The combination matters: the per-IP limit catches credential stuffing (many accounts, one IP), while the per-email+IP limit catches targeted attacks on a specific account.

On a successful login, both counters reset.

---

## What "verified email" means

`emailVerified: false` doesn't prevent login — it's a soft flag. The application can use it to gate certain features (like sending messages to others, or accessing premium content).

Verification tokens expire after 48 hours and are single-use.

---

## Cookies and CORS

The refresh token lives in a cookie with these flags:

| Flag       | Value                | Why                                               |
| ---------- | -------------------- | ------------------------------------------------- |
| `httpOnly` | `true`               | JavaScript cannot read it (XSS protection)        |
| `secure`   | `true` in production | Only sent over HTTPS                              |
| `sameSite` | `strict`             | Not sent on cross-site requests (CSRF protection) |
| `path`     | `/`                  | Available to all paths                            |
| `maxAge`   | 7 days               | Browser discards it after this                    |

The access token is stored in application memory (never in `localStorage`) and cleared on page close.
