# Organization Invites

Invites let an organization admin bring someone into their org by email —
whether or not that person already has an AMCore account. The recipient
gets an email with a link, signs in (or signs up), and accepts. On accept,
the server creates their membership with the role the admin chose.

The create endpoint returns the same `202 { "status": "invited" }` status
and body whether the recipient has an account, is already a member, or is
unknown. This is not a constant-time guarantee. Organization administrators
can inspect pending invitations; rate limits remain necessary. A `202` confirms
a committed invitation decision, not email delivery.

---

## The mental model

```
Admin invites email  →  202 { status: "invited" }  (always uniform)
                         + best-effort invite email delivery attempted

Recipient clicks link →  signs in / signs up  →  POST /auth/invites/accept
                         → membership created with the assigned role
```

- **Create** is a full team-administration action (`manage:TeamAccess`). It
  accepts a bearer token **or** an API key bound to the org with exact `manage:TeamAccess` scope and trusted owner.
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
`MEMBER` role resolved and stored when the invite is issued.

**What happens under the hood:**

| Recipient state              | DB effect                           | Email attempted? |
| ---------------------------- | ----------------------------------- | ---------------- |
| Already a member             | no invite/member change; audit only | no               |
| Has an account, not member   | pending invite created              | yes              |
| No account yet               | pending invite created              | yes              |
| Already has a pending invite | token rotated, expiry reset         | yes              |

Every case returns the same `202 { "status": "invited" }`. Only the
recipient — in their own mailbox — sees whether the email says "sign in"
or "create an account".

### The invite email

The email carries a link to the accept page with the raw invite token in
the query string:

```
${FRONTEND_URL}/<locale>/invite/accept?token=<raw token>
```

The CTA copy differs by whether the recipient already has an account
("Sign in to accept" vs "Create an account to join"); both link to the
same URL. The raw token exists **only** in this email — the server stores
just its SHA-256 hash and never returns or logs the raw value.

> The link carries the recipient's locale (`/ru/invite/accept`) because
> `apps/web` prefixes every locale and an emailed link cannot rely on a cookie
> the recipient's browser may not have — see
> [`docs/frontend/i18n-and-errors.md`](../frontend/i18n-and-errors.md).
>
> **The accept page is your application's responsibility.** The starter
> backend issues the link; the frontend route `/<locale>/invite/accept` (reading
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
deleted/missing role, or email mismatch — collapses to the same `400`
`INVITE_INVALID_OR_EXPIRED`, so a leaked or guessed token cannot be probed
across identities.

If the assigned role was deleted, the invitation remains visible with a null
`roleId` until expiry, revocation or reissue, but acceptance returns the same
`400 INVITE_INVALID_OR_EXPIRED`. It never substitutes another role. Reissue
requires a concrete valid role (or selects `MEMBER` when omitted).

Acceptance reads the current primary email and verification state under a lock,
not a cached credential email. Expiry is checked against the database wall clock
at the final claim after lock waits. The claim, membership, role link, ACL version
and durable audit commit together. Cache invalidation or limiter-reset failure
following a confirmed commit does not change the success response.

---

## 3. List and revoke invites

List active (pending, not expired) invites — bearer-only, requires full TeamAccess,
paginated:

```bash
curl "https://api.amcore.dev/api/v1/organizations/:orgId/invites?page=1&limit=20" \
  -H "Authorization: Bearer <admin token>"
# 200 OK
# { "data": [],
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

## Authorization and concurrency

Creating and revoking recheck the sender's primary identity, current membership
and complete normalized permissions in the write transaction. Full
`manage:TeamAccess` is required; a role called `Manager` or `ADMIN` does not
itself confer authority. An explicit trusted manager can invite any assignable
organization role. Relevant DENYs veto full team authority before API-key scopes
are applied. Platform privilege requires both admitted and currently locked
`SUPER_ADMIN` authority; a newly promoted credential does not gain a bypass.

A create request authenticated by API key rechecks the exact cryptographically
admitted key, its organization/owner binding, revocation, expiry and exact
`manage:TeamAccess` scope. Membership is mandatory even for a platform owner.
The key identifier is request-local evidence, never a client-supplied principal
field. Once issued, an invitation belongs to the organization: later sender
removal, demotion or key revocation does not invalidate its recipient link.

Writes lock actor user, organization, assigned role (when needed), then invitation.
Creation also acquires its per-email advisory lock before the organization and
locks an admitted API key after the organization. This ordering accommodates
foreign-key deletion actions. There are no automatic transaction retries.

Only one concurrent acceptance creates access. A successful revoke prevents
acceptance; acceptance first makes revoke return the accepted-invite error.
Repeated revocation preserves the first timestamp and revoker and adds no audit.
Reissue rotates the current pending token; after revocation it creates a new row.
Infrastructure failures return `409 CONFLICT` for a known transaction abort or
`503` for an unavailable/unconfirmed write. After `503`, inspect current membership
and invitations before retrying: commit acknowledgment may have been lost.

## Upgrade existing installations

Drain all old invitation writers before applying migration
`20261003180000_invitation_role_intent` and restarting with the repaired version.
The migration atomically revokes legacy null-role nonterminal invitations,
including expired ones, with a common UTC timestamp and no fabricated human
revoker. Concrete-role invitations and accepted/revoked history are unchanged.
Reinvite affected recipients with a concrete role. Do not roll back to code
that substitutes a role for a null assignment; maintenance-window recovery must
restore a compatible application/database pair.

## Expiry and cleanup

- Invites expire **7 days** after they are created (or last rotated).
- The daily 02:00 cleanup job eventually deletes **expired pending** invites;
  acceptance rejects them at expiry without waiting for cleanup.
- **Terminal** invites (accepted or revoked) are kept for a **30-day**
  audit window after reaching their terminal state, then garbage-collected.

---

## Error codes

| Code                        | Status | When                                                                           |
| --------------------------- | ------ | ------------------------------------------------------------------------------ |
| `INVITE_INVALID_OR_EXPIRED` | 400    | Token not found / expired / revoked / accepted / deleted role / email mismatch |
| `INVITE_EMAIL_NOT_VERIFIED` | 403    | Caller's email is not verified                                                 |
| `INVITE_ALREADY_MEMBER`     | 409    | Caller is already a member (race on accept)                                    |
| `BUSINESS_RULE_VIOLATION`   | 400    | Revoking an already-accepted invite                                            |

A known transaction abort uses `409 CONFLICT`. `503 SERVICE_UNAVAILABLE` means
an unavailable or unconfirmed write; `DATABASE_POOL_TIMEOUT` identifies a known
pool timeout. Infrastructure failures do not consume the negative-token budget.
