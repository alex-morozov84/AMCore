# Manage an organization member's API keys

Use **Organizations → Members → member menu → API keys** to inspect and revoke
integration credentials. The caller must currently belong to the selected
organization and have full TeamAccess. A live SUPER_ADMIN still needs membership
for these new routes. A role named ADMIN is not itself an authorization check.
The Operations Console is separate and is not needed for this interface.

## Inspect and revoke

1. Find the member by name or email on the Members page. Open their menu and
   choose **API keys**. Check the organization and member identity in the dialog.
2. Use **All / Unexpired / Expired / Revoked** to filter the list. Rows show scopes,
   creation, expiry and approximate last use. Pagination uses 20 rows per page.
3. Choose **Revoke…** for one key or **Revoke all…** for the member's entire
   organization-scoped set. Review the confirmation; Cancel changes nothing.
4. Confirm the permanent action. Consumers using revoked keys cannot authenticate
   on subsequent verification. Requests already admitted may finish.

The dialog keeps a stable height while filters and pages load. Card-shaped skeletons
replace the results; the shared pager stays in the footer. Status labels combine
text and icons with semantic colors: unexpired, expired and revoked.

Unexpired describes lifecycle, not effective access. Owner membership, current
permissions, scopes and route admission still apply. Last use is approximate and
cannot prove an integration is unused. You cannot view another person's secret,
create a key for them or undo revocation.

The matching count uses the selected status. The revocable count covers ALL
unrevoked keys of this user in this organization, including expired keys and keys
on other pages. **Revoke all** uses the server set after acquiring its lock; it
neither uses the visible page nor bans later issuance. A member can create another
key after the operation if current membership permits it.

## Results, failures and recovery

A confirmed success reports actual transitions and refreshes the list. An
already-revoked known key is a successful no-op. If revocation succeeds but
refresh fails, the dialog preserves the successful result and offers Check keys.

An unknown result means the server may have committed. Do not repeat the old all
request automatically. Choose **Check keys**, inspect the refreshed state and then
make a new deliberate confirmation if needed. A new all request can include keys
created since the previous request. Closing and reopening the dialog preserves
this uncertainty within the current mounted organization view; it is not durable
across reloads, navigation or session changes.

A changed membership identity returns 409; a removed member returns 404. Reload
current members before choosing the new membership. A foreign/missing/purged key
returns the same 404. A session/account/org change retires the old operation.
An unavailable or oversized read is not an empty list; Retry may not fix excessive
metadata. See the [bounded operator recovery](../operations/api-key-lifecycle.md#more-than-1000-keys-or-oversized-metadata).

## Removal and returning members

The existing backend member-removal operation atomically revokes that member's
keys ONLY in the selected organization, removes membership, records audit and
advances organization ACL. Returning to the organization requires a new key:
the old secret cannot authenticate again. Other organizations' keys are unchanged.
The last-administrator guard runs before any key revocation. A failed transaction
changes neither keys nor membership. The ready Members interface does not yet
provide a member-removal action; API removal is a separate operation.

All/remove accepts at most 1000 unrevoked keys. At 1001 it returns
`409 MEMBER_API_KEYS_LIMIT` without revoking any key or removing membership.
This is a work limit, not an issuance limit. Repeated batches while issuance
continues do not guarantee progress. Recovery can require maintenance to stop
issuance, use existing platform revoke batches<=100, then invoke the normal
member-removal API. It does not require the departing member's cooperation.
Do not delete membership with SQL to bypass this guard.

Revocation destroys hash/salt and retains safe metadata. Cleanup eligibility is
30 days from the first expiry/revoke, not 30 days from the last repeated request.
User/organization deletion can cascade sooner. Audit has separate retention.

## API contract

All new routes below require a personal bearer credential and selected org
context. API-key authentication is rejected even for SUPER_ADMIN-owned keys.
Base: `/api/v1/organizations/:orgId/members/:userId/api-keys`.

The route selects the organization through `orgId`; a prior switch-token request
is not required. Use a current personal access token. Get `memberId` and `user.id`
from the same row of `GET /api/v1/organizations/:orgId/members`: use `user.id`
for `:userId` and `memberId` for `expectedMemberId`. These identifiers differ.

| Method | Suffix           | Input                                                                                    | Result                                                                        |
| ------ | ---------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| GET    | none             | expectedMemberId; page default 1 max 10000; limit default 20 max 100; status default all | 200 safe list, identity, filtered total, revocableCount, asOf, revokeAllLimit |
| POST   | `/:keyId/revoke` | `{expectedMemberId}`                                                                     | 200 IDs and requested/affected counts; known no-op affected 0                 |
| POST   | `/revoke-all`    | `{expectedMemberId}`                                                                     | 200 IDs and actual counts, including empty 0/0                                |

DTOs reject unknown fields. All is independent of filters/pages. Expected membership
prevents an old dialog from operating on a later rejoin with the same user ID.
New commands recheck current authority under the organization lock; an old UI grant
or old ACL claim never authorizes a command alone. API/BFF body limit 4096 decoded
bytes, query 2048 UTF-8 bytes, API metadata 245760 bytes and browser envelope 262144.
Large row/identity metadata fails closed rather than exposing truncated scopes.

HTTP 400/413 rejects malformed/oversized input; 401/403 rejects credentials/authority;
404 means member/key unavailable;409 means membership conflict or limit. 429 honors
Retry-After. 503 write is unconfirmed; inspect before any new confirmation. See
OpenAPI `/docs` for exact schemas, security and responses.

The existing DELETE member preserves its explicitly supported original-bound,
live SUPER_ADMIN JWT membership bypass. It does NOT extend to this inventory or
these revoke commands. Personal unbound SUPER_ADMIN JWT requires membership.
Existing authorized API-key removal retains its exact manage:TeamAccess requirement.

## Custom presentation without ready UI

Import `useMemberApiKeys` and `useOrganizationContext` from
`@/entities/organization-context`. Pass the SAME existing context controller.
Never create another context owner inside the dialog or import feature internals.

```tsx
'use client'
import {
  useMemberApiKeys,
  type OrganizationAccessController,
} from '@/entities/organization-context'

export function MemberKeysModel({
  controller,
  userId,
  memberId,
}: {
  controller: OrganizationAccessController
  userId: string
  memberId: string
}) {
  const keys = useMemberApiKeys(controller, userId, {
    expectedMemberId: memberId,
    page: 1,
    limit: 20,
    status: 'all',
  })
  // Render your localized list and explicit confirmation using keys.data/available.
  // Only after confirmation: await keys.revoke(keyId), or keys.revoke() for all.
  // Handle committed/rejected/unknown/busy/retired; never automatically replay.
  return null
}
```

The model example leaves rendering and confirmation to your client component.
Use the following contract to implement that presentation; no private imports are needed.
`MemberKeyQuery`, `MemberKeyList` and `MemberKeyResult` are public types from `@amcore/shared`.

| Hook field                      | Contract                                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`                          | `MemberKeyList` or undefined; `organization: {id, name}`, `member: {memberId, userId, name, email}`, `data` rows, `total`, `page`, `limit`, `revocableCount`, `asOf`, `revokeAllLimit` |
| List row                        | `id`, `name`, `scopes: string[]`, `status`, `createdAt`, nullable `expiresAt`, `lastUsedAt`, `revokedAt`, `revocationReason`; timestamps are ISO strings                               |
| `ready` / `available`           | Authority is ready / this target's read succeeded and data exists; use `available` before confirming                                                                                   |
| `pending` / `error` / `retryAt` | Current read state; error is unknown; optional retry time is epoch milliseconds                                                                                                        |
| `busy`                          | A write for this member is pending; disable duplicate confirmation                                                                                                                     |
| `refresh(signal?: AbortSignal)` | Promise of `MemberKeyList` or undefined when retired; can reject; never repeats a write                                                                                                |
| `revoke(keyId?: string)`        | Promise of the outcome below; omit keyId for all, only after explicit confirmation                                                                                                     |

The outcome discriminator is `status`:

| Status                 | Additional fields and action                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `committed`            | `result: MemberKeyResult`, `followup`: ready/denied/missing/changed/error/retired. Preserve success even when followup is not ready; refresh or leave the unavailable target, never replay |
| `rejected` / `unknown` | `error: unknown`, optional `retryAt` in epoch milliseconds. Show a confirmed refusal / possible commit separately; unknown requires Check keys before a new confirmation                   |
| `busy` / `retired`     | No result; suppress duplicate submission / discard the old target's presentation                                                                                                           |

`MemberKeyResult` contains `organizationId`, `userId`, `memberId`, optional `keyId`,
`requestedCount` and `affectedCount`. It contains no secret. Bind confirmation to
session, organization, user, member and key; clear it when any target changes.
Ignore late success and failure from a retired target. A refreshed list is current
state, not a receipt proving whether a particular lost request committed.

Headless code does not toast, navigate or import ready widgets/Console. Its read timeout is 20 seconds; commands
use BFF 15 seconds and browser transport 20 seconds, followed by a separate bounded
5-second authority refresh. Timeout does not prove rollback.
The named server entry is `@/entities/organization-context/index.server`:
`readMemberKeys(orgId, userId, rawQuery, input)` and
`revokeMemberKeys(orgId, userId, rawCommand, input, keyId?)`.
IDs are strings; raw inputs are validated against the query/command contracts above.
Both return `Promise<{binding: string, data: T}>`, with `T` respectively
`MemberKeyList` or `MemberKeyResult`. Input is
`{expectedSession: string | undefined, headers: Headers, signal?: AbortSignal}`.
Use the existing server-only BFF route helpers to capture input from the request;
never pass a browser-supplied bearer or import this entry into client code.
BFF uses session binding, strict Origin on mutations, runtime schemas and private no-store responses. Keep these boundaries
when supplying your own layout. Shared primitives and contracts remain usable when
Console is disabled. [Integration](integration.md) and
[extension rules](extending-modules.md) explain placement and ownership.
