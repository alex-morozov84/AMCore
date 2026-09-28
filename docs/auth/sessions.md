# Sessions

Every login starts an independent refresh-token family. Each Session row is
one token generation with descriptive request metadata, not a verified device
or an activity history.

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

For a direct API client, the raw refresh token is sent as an `httpOnly` cookie.
The session record only holds the hash — even if someone got direct database
access, they couldn't reconstruct the raw token.

`apps/web` uses ADR-068's BFF session vault instead: the browser holds only
`amcore_session`, while the Next.js server stores the raw backend refresh token
in Redis and sends it to `apps/api` only on server-to-server calls. The session
model below is still the backend source of truth; the difference is where the
raw token lives in the bundled web client.

One user can have many sessions. They're fully independent — a session is one
login's refresh-token lineage, not "one per device": logging in twice on the
same device (a second browser profile, an incognito window, a repeated
manual login) creates a second, independent session, and a single browser
session can itself later carry an approximate location alongside its device
info (see [Listing active sessions](#listing-active-sessions)).

UA/IP are captured on registration, login, OAuth login callback and each refresh
generation. The bundled BFF preserves current visitor UA; missing UA is null.
Stored IP uses an opt-in peer-verified visitor claim when configured, otherwise
req.ip/socket fallback. See [GeoIP setup](../operations/geoip-setup.md#capturing-visitor-ip-through-the-bff).
This does not change password-login rate-limit identity, global Express proxy
trust, audit IP or authorization. Historical Node UA/internal peer IP is not
backfilled; its original visitor metadata cannot be reconstructed reliably.

## Operations Console host mode

The optional Operations Console host is a separate browser-session audience,
not another URL for the product session. Its browser holds only
`__Host-amcore_console_session`; the `__Host-` prefix requires `Secure`,
`Path=/`, and no `Domain`, so the cookie is host-only and cannot be shared with
a sibling product host. The opaque identifier resolves only in Redis keys under
`web:console-session:v1:*`, whose entries persist `audience: 'console'`.

The product `amcore_session` and `web:session:v1:*` remain unchanged. Neither
side reads the other cookie or namespace. Console admission is additionally a
live `SUPER_ADMIN` policy probe on every protected request, so a role demotion
takes effect on the next request even when the stored access token is still
within its normal lifetime. Console logout deletes only this console vault
entry and cookie.

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
      "ipAddress": "81.2.69.142",
      "location": { "city": "London", "countryCode": "GB" },
      "createdAt": "2024-03-20T10:00:00.000Z",
      "current": true
    },
    {
      "id": "sess_def456",
      "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)...",
      "ipAddress": "10.0.0.5",
      "location": null,
      "createdAt": "2024-03-18T14:22:00.000Z",
      "current": false
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 20
}
```

The `current: true` flag marks the session being used for this request. The
backend determines that from the request's `refresh_token` cookie, not from the
JWT alone. In `apps/web`, the dedicated BFF handler for
`/api/auth/sessions*` therefore attaches both `Authorization: Bearer ...` and
`Cookie: refresh_token=<vault token>` on its server-to-server call. The generic
`/api/[...path]` proxy intentionally never forwards browser cookies. Revoked or
expired refresh tokens are not listed here.

`location` is an approximate, nullable city/country derived from the stored
`ipAddress` via an optional local GeoIP database — `null` whenever GeoIP is
disabled, the database has not loaded, the address is private/reserved, or
there is no match. It never affects whether auth, listing, or revocation
work. See [GeoIP setup](../operations/geoip-setup.md) for deployment guidance. `city` is resolved server-side in the caller's
negotiated `Accept-Language` (falling back to English); a direct API client
that wants a specific language sends that header explicitly.

Settings keeps the existing session rows readable while refreshing its list
after a revocation. The table exposes `aria-busy` while the request is pending;
the result updates when the request completes.

The optional Console also displays this metadata; see the
[session presentation](../operations-console/users.md#manage-sessions).

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

As with the list endpoint, `apps/web` uses dedicated BFF handlers for session
revocation so the backend can still identify the current session from the
vault-held refresh token. Product code should call the same-origin
`/api/auth/sessions*` paths from the browser, not `apps/api` directly.

---

## Admin session management

A `SUPER_ADMIN` can view and revoke **another user's** sessions directly
through the following API routes.

The optional Console provides the same operations through its Sessions panel:
[Operations Console → Users](../operations-console/users.md#manage-sessions).

| Endpoint                                             | Purpose                                                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/users/:id/sessions`               | Paginated active sessions for the target user. Same envelope shape as the self-service list, plus an opaque `sessionId` (never the physical row id or a token hash) in place of `id`. |
| `DELETE /api/v1/admin/users/:id/sessions/:sessionId` | Revoke one session. `204` even if it was already inactive (idempotent); `404` if it never belonged to that user.                                                                      |
| `DELETE /api/v1/admin/users/:id/sessions`            | Revoke every active session for that user. Always `204`, even with zero active sessions.                                                                                              |

Each admin list item contains `sessionId`, nullable `userAgent`, `ipAddress`
and `location`, nullable `lastAuthAt`, and ISO `createdAt`/`expiresAt` timestamps.
`sessionId` stays stable across refresh rotation. `createdAt` is the current
token generation's issue time; `lastAuthAt` is password/login authentication
freshness, not last activity. There is no `current` flag in the admin view.
Pagination defaults to page 1 / limit 20, with a maximum limit of 100; `total`
counts active families across all pages. Reads use `Cache-Control: private,
no-store`. Send `Accept-Language` for city localization:

```bash
curl 'https://api.amcore.dev/api/v1/admin/users/<target-user-id>/sessions?page=1&limit=20' \
  -H 'Authorization: Bearer <super-admin-access-token>' \
  -H 'Accept-Language: en'
```

Use the returned admin `sessionId`, not a self-service row `id`, to revoke one:

```bash
curl -i -X DELETE 'https://api.amcore.dev/api/v1/admin/users/<target-user-id>/sessions/<session-id-from-list>' \
  -H 'Authorization: Bearer <super-admin-access-token>'

curl -i -X DELETE 'https://api.amcore.dev/api/v1/admin/users/<target-user-id>/sessions' \
  -H 'Authorization: Bearer <super-admin-access-token>'
```

Both return `204` without a response body on success. A `403 STEP_UP_REQUIRED`
requires re-authentication with the operator's own password at
`POST /api/v1/auth/step-up`; direct API clients use its returned access token
when retrying. OAuth-only accounts receive `STEP_UP_METHOD_UNAVAILABLE`.
A `404` on revoke-one means the family is absent or does not belong to the
target; invalid IDs/pagination return `400`, missing bearer credentials or
API keys return `401`, insufficient system role returns `403`, and privileged
mutation throttling can return `429`. Do not repeatedly retry a terminal
freshness or authorization error.

Both `DELETE` routes require step-up (a recently re-authenticated admin
session) and reject a target equal to the admin's own account — an admin
manages their own sessions through the self-service endpoints above, not
these. Revoking blocks future refresh immediately; an access token already
issued before the revoke can remain valid until its own expiry (default 15
minutes, configurable via `JWT_ACCESS_EXPIRATION`) — the same residual-access
caveat documented for [system-role changes](#when-sessions-are-automatically-invalidated).
Every successful list read is itself audited (`admin.user.sessions_viewed`,
bounded page/limit/result-count metadata only — no IP/user-agent/location
values), hidden from Audit browsing by default the same way
`admin.audit_logs.viewed` is; revoke actions are audited as
`admin.user.session_revoked` / `admin.user.sessions_revoked`.

This is a starter-owned recovery/security control, distinct from instant
access-token invalidation (an already-issued access token is never
force-expired) — that remains a separately tracked possible future
enhancement, not part of this feature.

---

Organization `/switch` does not renew this residual access: its JWT retains the
parent's expiry, including repeated exchange. Preserved `sid` supports existing
FreshAuth checks but is not live-session introspection. Common privilege admission
also checks current primary role before every privileged bypass, independently of
whether the original session was cleaned up. Ordinary login/refresh/step-up retain
their own issuance lifetime.

## When sessions are automatically invalidated

Sessions don't just expire — they can be invalidated by specific events:

| Event                      | What gets invalidated                 |
| -------------------------- | ------------------------------------- |
| Password reset             | All sessions (every device signs out) |
| Session revoked by user    | That specific session only            |
| "Sign out everywhere"      | All sessions except current           |
| Logout                     | Current session only                  |
| System-role change         | All sessions of the affected user     |
| Admin-revoked session      | That specific session only            |
| Admin-revoked all sessions | All sessions of the target user       |
| Session expired (7 days)   | Cleaned up by nightly job             |

A **system-role change** (e.g. a `SUPER_ADMIN` promotion or demotion via the
admin API) revokes **all** of the target user's sessions, so they must
re-authenticate. This pairs with the system-role freshness check
([rbac.md](./rbac.md)): a demotion loses privileged access on the next request,
and a promotion cannot silently elevate an existing refresh session — it requires
a fresh login.

---

## Step-up re-authentication

Each session tracks when it was last authenticated (`lastAuthAt`). Destructive
admin operations — system-role changes, admin session revocation and
`POST /admin/cleanup` — require
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
