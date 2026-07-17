# Sessions

Every login creates a session — a record linking a user to a device. Sessions are how the system tracks who is logged in where.

---

## How sessions work

When you log in, the backend creates a **session** in the database:

```
Session {
  id:           "sess_abc123"
  userId:       "cm1abc..."
  refreshToken: "<SHA-256 hash of the raw token>"
  userAgent:    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)..."
  ipAddress:    "192.168.1.1"
  expiresAt:    "2024-03-27T10:00:00.000Z"  ← 7 days from now
  createdAt:    "2024-03-20T10:00:00.000Z"
}
```

The raw refresh token is sent to the browser as an `httpOnly` cookie. The session record only holds the hash — even if someone got direct database access, they couldn't reconstruct the raw token.

One user can have many sessions (one per device). They're fully independent.

---

## Token rotation

Every time you call `POST /auth/refresh`, the old refresh token is **immediately revoked** and a new one is issued:

```
Day 1:  Login → refresh_token = "abc123..."
Day 3:  Refresh → old "abc123..." revoked → refresh_token = "xyz789..."
Day 5:  Refresh → old "xyz789..." revoked → refresh_token = "qrs456..."
```

**Why this matters:** If someone intercepts your refresh token (from a log, a compromised network, etc.), they have a very short window to use it. The moment the real client refreshes, the stolen token becomes worthless.

Revoked refresh tokens are kept briefly in the session family so the backend can detect replay. If a rotated token is used again, the whole token family is invalidated and the current session is signed out.

---

## Refresh the access token

**Endpoint:** `POST /api/v1/auth/refresh`

No body needed — the refresh token is read from the `refresh_token` cookie.

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/refresh \
  --cookie "refresh_token=abc123..."
```

**Success response** `200 OK`:

```json
{
  "accessToken": "eyJhbGci..."
}
```

A new `refresh_token` cookie is set with the rotated token.

**Errors:**

| Code            | HTTP | When                                                      |
| --------------- | ---- | --------------------------------------------------------- |
| `TOKEN_INVALID` | 401  | Cookie missing, token not found in DB, or session expired |

---

## Listing active sessions

**Endpoint:** `GET /api/v1/auth/sessions`

Paginated list. Accepts the canonical pagination query parameters:
`?page=N&limit=M` with `1 ≤ page` and
`1 ≤ limit ≤ 100`; both default to `page=1, limit=20` if omitted.
Sessions are ordered newest first (`createdAt DESC, id ASC`) so page
boundaries are deterministic.

```bash
curl 'https://api.amcore.dev/api/v1/auth/sessions?page=1&limit=20' \
  -H "Authorization: Bearer eyJhbGci..."
```

**Success response** `200 OK`:

```json
{
  "data": [
    {
      "id": "sess_abc123",
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36...",
      "ipAddress": "192.168.1.1",
      "createdAt": "2024-03-20T10:00:00.000Z",
      "current": true
    },
    {
      "id": "sess_def456",
      "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)...",
      "ipAddress": "10.0.0.5",
      "createdAt": "2024-03-18T14:22:00.000Z",
      "current": false
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20
}
```

The `current: true` flag marks the session being used for this request. Revoked or expired refresh tokens are not listed here.

---

## Revoking a specific session

**Endpoint:** `DELETE /api/v1/auth/sessions/:sessionId`

```bash
curl -X DELETE https://api.amcore.dev/api/v1/auth/sessions/sess_def456 \
  -H "Authorization: Bearer eyJhbGci..."
```

You can only revoke your own sessions. Attempting to delete someone else's session returns `404`.

**Success response:** `204 No Content`

---

## Revoking all other sessions

**Endpoint:** `DELETE /api/v1/auth/sessions`

Signs out all devices except the current one. Useful for "sign out everywhere" functionality.

```bash
curl -X DELETE https://api.amcore.dev/api/v1/auth/sessions \
  -H "Authorization: Bearer eyJhbGci..."
```

**Success response:** `204 No Content`

---

## When sessions are automatically invalidated

Sessions don't just expire — they can be invalidated by specific events:

| Event                    | What gets invalidated                 |
| ------------------------ | ------------------------------------- |
| Password reset           | All sessions (every device signs out) |
| Session revoked by user  | That specific session only            |
| "Sign out everywhere"    | All sessions except current           |
| Logout                   | Current session only                  |
| System-role change       | All sessions of the affected user     |
| Session expired (7 days) | Cleaned up by nightly job             |

A **system-role change** (e.g. a `SUPER_ADMIN` promotion or demotion via the
admin API) revokes **all** of the target user's sessions, so they must
re-authenticate. This pairs with the system-role freshness check
([rbac.md](./rbac.md)): a demotion loses privileged access on the next request,
and a promotion cannot silently elevate an existing refresh session — it requires
a fresh login.

---

## Step-up re-authentication

Each session tracks when it was last authenticated (`lastAuthAt`). Destructive
admin operations — `PATCH /admin/users/:id` and `POST /admin/cleanup` — require
that timestamp to be recent (within `STEP_UP_MAX_AGE_SECONDS`, default 10
minutes). If it is stale, the request is rejected with `403 STEP_UP_REQUIRED`.

To refresh it, the user re-enters their password at **`POST /auth/step-up`**.
This updates **only the current session's** `lastAuthAt` — it does not create a
new session or rotate the refresh token. Importantly, a silent
`POST /auth/refresh` **preserves but does not renew** the window: refreshing your
access token does not count as re-authentication.

OAuth-only accounts (no password) cannot use password step-up and receive
`403 STEP_UP_METHOD_UNAVAILABLE`. Sessions created before this feature shipped
have a `NULL` `lastAuthAt` and must re-login (or step up) before performing a
guarded operation.

---

## Nightly cleanup

Expired sessions are cleaned up automatically by a scheduled job that runs every night. The cleanup uses indexed queries (by `expiresAt`) to stay fast even with millions of sessions.

You don't need to worry about this — it's fully automatic.
