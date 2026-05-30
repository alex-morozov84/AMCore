# Organization Invites

Invites let an organization admin bring someone into their org by email —
whether or not that person already has an AMCore account. The recipient
gets an email with a link, signs in (or signs up), and accepts. On accept,
the server creates their membership with the role the admin chose.

This flow is **non-enumerating**: the create endpoint returns the exact
same `202 { "status": "invited" }` no matter what — so an admin cannot use
it to discover whether an email is registered, already a member, or
unknown.

---

## The mental model

```
Admin invites email  →  202 { status: "invited" }  (always uniform)
                         + invite email sent to the recipient

Recipient clicks link →  signs in / signs up  →  POST /auth/invites/accept
                         → membership created with the assigned role
```

- **Create** is an org-admin action (`Manage` on `Organization`). It
  accepts a bearer token **or** an API key bound to the org.
- **List / revoke** and **accept** are **bearer-only** — accepting proves
  ownership of the invited email, which a long-lived API key must not do.

---

## 1. Send an invite

```bash
curl -X POST https://api.amcore.dev/api/v1/organizations/:orgId/members/invite \
  -H "Authorization: Bearer <admin token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "newperson@example.com", "roleId": "<role-id>"}'
# 202 Accepted
# { "status": "invited" }
```

`roleId` is optional — when omitted, the invitee is assigned the system
`MEMBER` role on accept.

**What happens under the hood:**

| Recipient state              | DB effect                   | Email sent? |
| ---------------------------- | --------------------------- | ----------- |
| Already a member             | nothing (silent no-op)      | no          |
| Has an account, not member   | pending invite created      | yes         |
| No account yet               | pending invite created      | yes         |
| Already has a pending invite | token rotated, expiry reset | yes         |

Every case returns the same `202 { "status": "invited" }`. Only the
recipient — in their own mailbox — sees whether the email says "sign in"
or "create an account".

### The invite email

The email carries a link to the accept page with the raw invite token in
the query string:

```
${FRONTEND_URL}/invite/accept?token=<raw token>
```

The CTA copy differs by whether the recipient already has an account
("Sign in to accept" vs "Create an account to join"); both link to the
same URL. The raw token exists **only** in this email — the server stores
just its SHA-256 hash and never returns or logs the raw value.

> **The accept page is your application's responsibility.** The starter
> backend issues the link; the frontend route `/invite/accept` (reading
> `?token=`, ensuring the user is authenticated, then calling the accept
> endpoint) is implemented by the app that forks this starter.

Email delivery is **best-effort**: after the invite row is committed, the
backend renders and sends the invite email directly via the configured provider.
The raw accept token is carried only inside the email link and is never
serialized into BullMQ/Redis/Bull Board. Dispatch failures are logged and
swallowed, never failing the `202`. If delivery fails, the invite still exists
and the admin can re-invite (which rotates the token and re-sends).

---

## 2. Accept an invite

```bash
curl -X POST https://api.amcore.dev/api/v1/auth/invites/accept \
  -H "Authorization: Bearer <recipient token>" \
  -H "Content-Type: application/json" \
  -d '{"token": "<raw token from the email>"}'
# 200 OK
# { "organizationId": "org_xyz", "roleId": "role_member" }
```

Requirements:

- The caller must be **authenticated** (bearer token).
- The caller's **canonical email** must match the email the invite was
  issued for.
- The caller's email must be **verified** — otherwise `403`
  `INVITE_EMAIL_NOT_VERIFIED`.

Every other failure — token not found, expired, revoked, already accepted,
or email mismatch — collapses to the same `400`
`INVITE_INVALID_OR_EXPIRED`, so a leaked or guessed token cannot be probed
across identities.

If the invite's custom role was deleted between create and accept, the
server falls back to the system `MEMBER` role and returns that id.

---

## 3. List and revoke invites

List active (pending, not expired) invites — bearer-only, ADMIN only,
paginated:

```bash
curl https://api.amcore.dev/api/v1/organizations/:orgId/invites?page=1&limit=20 \
  -H "Authorization: Bearer <admin token>"
# 200 OK
# { "data": [ { "id", "email", "roleId", "invitedById", "expiresAt", "createdAt" } ],
#   "total": 1, "page": 1, "limit": 20 }
```

Token hashes are never included in the response.

Revoke a pending invite — idempotent:

```bash
curl -X DELETE https://api.amcore.dev/api/v1/organizations/:orgId/invites/:inviteId \
  -H "Authorization: Bearer <admin token>"
# 204 No Content
```

- Revoking an already-revoked invite returns `204` (idempotent).
- Revoking an **accepted** invite returns `400` `BUSINESS_RULE_VIOLATION` —
  remove the resulting member via
  `DELETE /organizations/:orgId/members/:userId` instead.

---

## Expiry and cleanup

- Invites expire **7 days** after they are created (or last rotated).
- The nightly cleanup job deletes **expired pending** invites immediately.
- **Terminal** invites (accepted or revoked) are kept for a **30-day**
  audit window after reaching their terminal state, then garbage-collected.

---

## Error codes

| Code                        | Status | When                                                            |
| --------------------------- | ------ | --------------------------------------------------------------- |
| `INVITE_INVALID_OR_EXPIRED` | 400    | Token not found / expired / revoked / accepted / email mismatch |
| `INVITE_EMAIL_NOT_VERIFIED` | 403    | Caller's email is not verified                                  |
| `INVITE_ALREADY_MEMBER`     | 409    | Caller is already a member (race on accept)                     |
| `BUSINESS_RULE_VIOLATION`   | 400    | Revoking an already-accepted invite                             |
