# Organization invitations

An organization manager can invite a person by email and choose a complete set
of roles. A direct API client signs in or creates an account, verifies their email,
inspects the organization and roles, and explicitly accepts. Signing in, signing
up, opening a link or verifying an email never creates membership.

For example, invite Dana with `MEMBER` and your organization’s `Analyst` role.
Acceptance creates one membership with both roles. If Dana already has access,
acceptance reports `already_access` and preserves Dana’s existing roles.

Management, private inspection, acceptance and receipt recovery require a personal
bearer credential. Public admission and invited registration use the scoped
continuation protocol below; neither requires an existing account. API keys cannot
issue, inspect, accept, reissue or revoke invitations. Management additionally
requires actual membership in the selected organization and unrestricted
`manage:TeamAccess`; a platform administrator has no invitation bypass.

## Issue, find and manage invitations

This delivery provides the API and direct-client contracts. The starter invitation
email points to `/invite/accept`; its ready recipient screen and management UI are
not supplied yet. Use the direct API protocol below until that frontend is supplied.

Paths in this guide are relative to `/api/v1`. The interactive API reference at
`/docs` documents schemas, authentication and error responses.

| Action              | Request                                                                                  | Result                                              |
| ------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Issue               | `POST /organizations/{orgId}/invites`, `{email,roleIds?}`                                | `202 {status:"invited"}`                            |
| Find                | `GET /organizations/{orgId}/invites?page=1&limit=20&status=pending&search=dana`          | Paginated complete invitation rows                  |
| Discover roles      | `GET /organizations/{orgId}/invites/role-choices`                                        | Paginated compact roles plus complete `defaultRole` |
| Repeat issuance     | `POST /organizations/{orgId}/invites/{id}/reissue`, `{expectedGeneration,mode:"repeat"}` | `202 {status:"invited"}`                            |
| Replace role intent | Same reissue path, `{expectedGeneration,mode:"replace",roleIds}`                         | `202 {status:"invited"}`                            |
| Revoke              | `DELETE /organizations/{orgId}/invites/{id}?expectedGeneration=1`, no body               | Empty `204`                                         |
| Recover own command | `GET /organizations/{orgId}/invite-operations/{operationId}`                             | Committed safe acknowledgment or `unknown`          |

Issue, reissue and revoke require `X-Invitation-Operation-Id`, a freshly generated
UUIDv7 with a cryptographically random suffix. Use `createInvitationOperationId()`
from `@amcore/shared` in an application client. Keep the same ID and exact command
when recovering an uncertain result; a deliberate new action uses a new ID.

```bash
curl -X POST 'https://api.example.com/api/v1/organizations/<org-id>/invites' \
  -H 'Authorization: Bearer <organization-jwt>' \
  -H 'X-Invitation-Operation-Id: <fresh-uuidv7>' \
  -H 'Content-Type: application/json' \
  -d '{"email":"dana@example.com","roleIds":["<member-role-id>","<analyst-role-id>"]}'
```

Replace bracketed placeholders with your organization’s values. `roleIds` must
contain 1–20 unique, assignable IDs. Omission resolves the concrete system MEMBER
role once at fresh issuance. An explicit empty set is invalid. A missing or
ambiguous default role fails rather than inventing a label or permission set.

`202` confirms a committed invitation decision, including a silent no-op for an
existing member. It does not reveal whether an account exists or confirm email
delivery. No email is sent to an existing member. Another pending or retained
expired invitation returns `409 INVITE_ALREADY_PENDING`; find and explicitly
reissue it instead of silently rotating its link.

The list defaults to pending invitations. `status=expired` includes invitations
for 30 days after expiry; `all` combines both. Search is literal canonical-email
contains, at most 254 characters. Pagination defaults to 20, allows 1–100 rows and
pages 1–10000. Rows sort by latest issuance then ID and include generation,
issuance/expiry timestamps, status, complete role intent and `intentValid`.
`issuedAtEstimated` marks migrated issuance dates estimated from original creation.
No invitation token/hash, inviter identity or delivery status is returned.

A reissue increases generation, gives a new seven-day deadline and invalidates
all earlier tokens and continuations. Repeat preserves the entire role set.
If a requested role was deleted, the list retains its issued name and ID with a
null live role. Repeat and acceptance fail; replace requires choosing the entire
new role set. Permissions of live roles remain current, including permission
edits after issuance. Generation protects role selection, not an ACL snapshot.

Revoke affects the invitation only. A same-generation repeat revoke is safe;
accepted invitations return `409 INVITE_SETTLED`. To remove organization access,
use the member-management API. A stale `expectedGeneration` returns
`409 INVITE_GENERATION_CONFLICT`; refresh before making another decision.

## Inspect and accept as a direct API client

Authenticate with a current personal session. Inspect the token from the original
email before presenting consent:

```http
POST /api/v1/auth/invites/inspect
Authorization: Bearer <personal-jwt>
Content-Type: application/json

{"token":"<invitation-token>"}
```

A matching unverified account receives `{state:"verify_email",email}`. Verify
through the ordinary email-verification flow and inspect again. A matching
verified account receives `ready` with invitation ID, generation, organization,
complete current role names/descriptions and expiry, or `already_access` with
organization and descriptor. A mismatched account receives a generic account
mismatch without the recipient email, organization or roles.

Save the returned ID/generation as nonsecret consent intent, then send:

```http
POST /api/v1/auth/invites/accept
Authorization: Bearer <personal-jwt>
X-Invitation-Operation-Id: <fresh-uuidv7>
Content-Type: application/json

{"expectedInviteId":"<inspected-invite-id>","expectedGeneration":1,"token":"<invitation-token>"}
```

Successful fresh acceptance returns
`{status:"accepted",organizationId,memberId}`. Existing access returns
`{status:"already_access",organizationId}` without replacing roles. Current
primary email, verification, invitation generation, complete roles and database
expiry are checked under locks. Membership, role links, ACL change, audit and
operation receipt commit atomically.

Invalid, expired, revoked, superseded, consumed or deleted-role credentials fail
fresh execution. An already committed matching operation returns its original
result even when the credential has since expired or been consumed. The same ID
with a different target/generation conflicts before credential lookup.

## Recover an uncertain outcome

A timeout or `503` can occur after commit. Do not automatically create a new ID
or repeat a mutation. Read your own operation:

```http
GET /api/v1/auth/invites/operations/<operation-id>
Authorization: Bearer <current-personal-jwt>
```

A committed proof contains `intent`, original `result` and current
`access:"present"|"removed"`. Compare its intent with your saved descriptor.
It requires neither the old token nor a continuation. Removed access stays
removed; recovery never grants membership again. Organization or account hard
deletion removes its proof.

`{state:"unknown"}` does not prove rollback: an earlier request may still be
running. With a valid credential, explicitly retry the identical command with
its original ID, which serializes against that request. Without a credential,
use read-only recovery/current-state inspection; reopen the original email for
fresh consent when needed. First execution is limited to 24 hours from the UUIDv7
timestamp, with at most five minutes of future skew. Completed proofs are
retained 30 days; a pruned old ID cannot execute as a new command.

## Scoped signup and authentication

A server client can exchange a valid invitation token with
`POST /auth/invites/continuations`, `{token}`, obtaining
`{credential,expiresAt,intent}`. The credential is a 256-bit scoped secret, with a
30-minute absolute lifetime capped by invitation expiry. Store it server-side.
Only its hash is stored in the API database. Admission never consumes the invite
or creates an account, so email-link scanning cannot join an organization.

Send `X-Invitation-Continuation` to these endpoints:

| Endpoint                                   | Request                                                                                      | Result                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /auth/invites/continuations/context` | Empty body                                                                                   | Fixed signup `{email,expiresAt}`, no account-existence information        |
| `POST /auth/invites/register`              | `{password,name?,locale?}`                                                                   | Unverified ordinary account, personal auth credentials and refresh cookie |
| `POST /auth/invites/continuations/inspect` | Personal bearer, empty body                                                                  | Same private inspect states as direct-token inspection                    |
| `POST /auth/invites/accept`                | Personal bearer, operation header, `{expectedInviteId,expectedGeneration,continuation:true}` | Explicit acceptance/replay                                                |

Invited registration derives email from current invitation authority. It never
creates an organization/member or marks email verified. Expiry/reissue before
its account-creation transaction commits prevents creation. If the account was
committed but the response was lost, sign in or reset its password; do not replay
registration blindly. A later reissue can leave an ordinary account without access.

`AUTH_PUBLIC_SIGNUP_ENABLED=true` is the default. Set it to `false` to close
ordinary email and new-account OAuth registration. Existing accounts can still
sign in. Valid invitation signup remains available; invited OAuth additionally
requires matching canonical provider email and current invite intent. Existing
provider verification/linking rules apply. Telegram remains link-only. Read
`GET /auth/signup-policy` for a public projection; hiding a register button does
not enforce this policy.

Verification never joins or creates a session. A verification email opened in a
new tab has no invitation selector: return to the invitation tab and refresh
current identity, or reopen the original invitation email. Another device or an
expired continuation requires sign-in and reopening the original email. Password
reset revokes sessions; sign in again and reopen, without a revocation bypass.

Server BFF clients can opt into durable authentication handoff using paired
`X-Invitation-Auth-Attempt-Id` and `X-Invitation-Handoff-Key`, alongside valid scoped
continuation. OAuth start also requires matching `X-Invitation-Attempt-Id`.
New session/account and the handoff record commit together. The newly published
browser cookie must be explicitly acknowledged before
`POST /auth/invites/auth-handoffs/{attemptId}/confirm`, using cleanup key and the
exact new personal session. Abort with the cleanup key revokes only an
unconfirmed tagged session; confirmed abort conflicts. Confirmation expires in
60 seconds and a database-only minute sweep revokes overdue pending sessions.
Pending/aborted sessions cannot refresh into an ordinary child or use personal
invitation endpoints. Repeating the same auth attempt never issues another session.

## Security, limits and operations

Invitation JSON is bounded to 16 KiB; admission and acceptance use 2 KiB. Queries use
2 KiB and responses 256 KiB. Unknown/duplicate query keys and unexpected bodies on
bodyless commands are rejected. Reads use coherent bounded snapshots. Writes
use a two-second lock ceiling and the existing stricter four-second transaction
ceiling, without automatic retries.

Public admission allows 20/minute/IP; scoped reads 60/minute/credential, invited
registration 5/hour/email and IP, management commands 20/minute/actor and
organization, including receipt replay. Fresh create and repeat/replace reissue
also share the stricter issuance-attempt allowance: 3 per hour per organization
and canonical recipient email, and 30 per hour per actor and organization.
Admission is atomic in Redis and fails closed when Redis is unavailable; limiter
keys contain a digest of the email, not the address. Each admitted fresh attempt
extends that counter's one-hour window. Matching committed receipt replay is
checked first and does not consume another issuance allowance or send again.
An existing-member create no-op still counts as a fresh attempt; an admitted
attempt is not refunded if its later database work rolls back. Other HTTP/global
limits still apply to replay. `429` carries `Retry-After` (3600 seconds for an
exhausted hourly allowance); wait before making a fresh request.
Existing login/verification/reset/OAuth and global rate limits remain active.

Secret-bearing invitation endpoints return `no-store`, `no-referrer` and
`noindex,nofollow`. Generic browser BFF proxying closes the entire invitation
family, including encoded aliases, and strips browser-supplied invitation secret
headers. Use dedicated server adapters; do not expose API refresh/access or
continuation credentials in browser storage, URLs, component props or query keys.

Email dispatch is best-effort after commit. The transaction captures organization
name, inviter name/email and the complete issued role names under its existing
locks; this ephemeral snapshot supplies localized English/Russian content even
if display metadata changes afterward. The command waits at most 250ms for its
single direct dispatch attempt after commit. A timeout or provider rejection does
not undo the invitation, audit or receipt; `202` never promises delivery. A late
provider completion may still deliver the original link. There is no automatic
retry or second send on receipt replay. An explicit fresh resend rotates the link
and consumes the issuance allowance. Secret links go directly to the provider,
never through BullMQ. Disable link tracking and redact query credentials
at your ingress/mail infrastructure; application headers alone do not protect
initial request history or external provider logs. See [email security](../email/security.md).

Expired invitations remain recoverable by managers for 30 days after expiry.
Accepted/revoked records remain 30 days after settlement. Daily cleanup makes records eligible after those retention cutoffs and deletes
bounded batches with locked current-state checks; a reissued row cannot be
removed using stale expiry. Continuations expire absolutely; operation proofs
are pruned after 30 days and settled handoff metadata after 24 hours.

## Upgrade an existing installation

Stop and drain old invitation writers before deploying migration
`20261004190000_invitation_intent_and_settlement` with the matching application.
The old `POST /organizations/{orgId}/members/invite` route is removed; migrate
writers to the new invitation namespace and operation/generation contracts.
There is no legacy alias with silent token rotation. The atomic issuance limiter
uses a new digest-based Redis key namespace; old non-atomic counters cannot be
carried across implicitly. To preserve a full hourly allowance across an upgrade,
drain old issuance writers and wait one hour before enabling new issuance. Do not
run old and new writers together or assume their counters form a shared budget.

Existing concrete role assignments become singleton immutable intents. Tokens,
hashes and deadlines are preserved; generation starts at 1. Issuance time is
estimated from creation and marked accordingly. Legacy null-role rows are marked
invalid, with no substituted MEMBER role. Earlier migration behavior may already
have revoked such rows; terminal state is preserved. Explicitly issue or replace
valid role intent as appropriate. Restore a compatible application/database pair
for rollback; old single-role writers are incompatible with the new schema.
