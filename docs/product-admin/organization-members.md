# Organization members and role assignment

Open `/manage/organizations/[id]/members` (with the locale prefix in multi-locale builds)
from the **Members** navigation tab on the organization overview. Overview keeps
the Organization and Your access cards; Members shows the member list. Both
sections retain the organization heading and route-backed navigation, supporting
direct links, reload and browser Back/Forward. The signed-in user must currently
belong to that organization and have full TeamAccess. Being a platform
super-administrator does not waive membership on these endpoints. API keys cannot
use the member list, role snapshot or full replacement endpoints.

The members tab can be narrowed to the holders of one role with `?role=<roleId>` (the role page links
there). Role-definition editing (see the [Roles tab](role-definitions.md#ready-role-screens)) and invitations are separate workflows.
The Members page changes role assignments and supports [confirmed member removal](#remove-a-member). For route placement and a
different custom presentation, use the [integration guide](integration.md#custom-member-editor).

## Assign or remove roles

1. On the organization's **Members** page, find the member by name or email and
   choose **Edit roles**.
2. Select or clear existing roles. Search and **All roles / Assigned** change
   the visible choices; your complete unsaved selection remains intact.
3. If editing your own roles, acknowledge the access warning. Role descriptions
   do not predict effective permissions, and adding a DENY role can remove access.
4. Choose **Save** to replace the complete selected set, or **Cancel** to discard
   the draft. A confirmed Save with a successful follow-up closes the dialog.

If the interface asks you to review current roles, compare the persisted set
before making another deliberate change. That review replaces the draft; it
does not retry the earlier write.

## Ready interface

Each row has **API keys** for [safe inventory and explicit revocation](member-api-keys.md), **Edit** (roles) and **Access**, which explains what the person can do in this
organization and which roles give or block it; see the
[member access explanation](member-access.md).

The page uses shared FilterPanel, DataTableSurface, Table and SearchField primitives,
with the same filter/table surfaces as the Console. The search panel precedes the
result count and the separately framed table; no repeated visible Members heading. Desktop shows a table;
small screens show member cards. Name/email search commits after 300 ms of idle
input. Enter and Clear commit immediately and return to page 1. Results paginate
in groups of 20. Ready-page search and page are canonical URL parameters; search
uses replace navigation without scrolling, so keystrokes do not add history
entries. Reload and direct links preserve the view; deliberate page changes add history
entries, while search commits replace the current entry. A page action cancels pending
search drafts. Changing organization cancels the previous search and reads.
Custom consumers can keep local state or inject their own view/navigation adapter.

**Edit roles** opens a dialog containing existing system and organization roles.
The dialog shows the member name and email. Role descriptions are shown when
provided; absent descriptions are identified explicitly rather than inferred
from a name. Descriptions are metadata, not a computed effective-permission
summary. All roles / Assigned filters indicate their active state; Assigned
shows persisted assignments. A fixed-height scrolling choice region displays
a structural skeleton during search and an explicit retry state on read failure,
while keeping the search, selected count and draft mounted. The checklist preserves the full selected set when search or pagination changes;
Save replaces that complete set in one transaction. Enter in role search filters
choices rather than submitting Save. The interface does not create roles. Cancel and Save share the dialog footer.
A confirmed Save with a ready follow-up closes the ready dialog; the list is
already refreshed. Ordinary interaction has no manual Refresh or Reset controls.

The first role read can fail before any member snapshot is available. The dialog
then shows a completed localized error with Retry and an available Close action,
not continuing loading skeletons. Retry respects the server's Retry-After delay;
a successful retry loads the complete snapshot. A read deadline also settles
this state, and closing the dialog retires any late response.

When a member page is beyond the returned total (for example after the list
shrinks or an old direct link is opened), the ready widget requests the last
valid page, or page 1 for an empty list. It keeps the committed search and any
open role draft. Controlled consumers receive this request through `onQueryChange`;
they continue to own navigation and must apply the requested page to display
results. Recovery is bounded per query/total identity, so a consumer that has not
applied the requested page does not cause a loop.

Changing any of your own roles requires acknowledging the warning: added custom
DENY rules can remove access as well as removed roles. A zero-role membership
remains a membership, but grants no permissions through organization roles. The
last holder of the builtin ADMIN role cannot lose that role through this operation.
A custom role named ADMIN does not satisfy this protection.

A Save waits at most five seconds for transport and another five seconds for the
shared authority/read follow-up. Duplicate Save stays blocked through follow-up.
An acknowledged write remains saved when follow-up fails. After an error or
deadline the dialog can be closed. An unconfirmed write is never replayed
automatically: refresh and compare persisted assignments before another deliberate
Save. A changed membership or ACL revision requires reviewing current roles.
Automatic reads never silently replace an unsaved selection. Conflict/unknown
states offer one explicit Review current roles action that adopts a freshly
authorized snapshot; failed recovery preserves the selection and leaves exit
available. Review does not replay the write. Its wait is bounded at ten seconds.

## API contract

All routes below are under `/api/v1/organizations/:orgId` and require bearer auth,
current membership and full TeamAccess. Use the development OpenAPI document at
`/docs` for complete schemas and route security metadata:

| Method and suffix              | Contract                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /members`                 | Literal name/email search, optional `roleId` (only holders of that role; unknown matches nobody), `page`, `limit`; safe user fields, joined date, role count and preview of at most 10 roles |
| `GET /members/:userId/roles`   | Member identity, ACL revision, complete assigned set when editable and paginated role choices; `section=available\|assigned`                                                                 |
| `PATCH /members/:userId/roles` | `{expectedMemberId, expectedAclVersion, roleIds}`; 200 with canonical IDs, resulting revision and `changed`                                                                                  |

Queries default to page 1 and limit 20; limit is at most 100. Search is trimmed
and limited to 100 Unicode code points. Member search matches name/email and role
search matches role name, case-insensitively as literal substrings. Encode query
values with URLSearchParams or an equivalent URL encoder; `%` and `_` are not
wildcards. Role choices default to `section=available`; `assigned` lists persisted
assignments. The public browser hooks use a fixed page size of 20.
Query objects and replacement DTOs reject
unknown fields. Replacement accepts at most 1000 unique existing role IDs belonging
to this organization or builtin system roles. It rejects foreign/missing roles
without disclosing their metadata. No-op still validates membership identity and
ACL revision under the same lock, but changes no timestamp, revision or audit row.

`MEMBER_ROLES_CONFLICT` (409) means the membership identity or ACL revision changed.
`MEMBER_UNAVAILABLE` (404) means the target membership is unavailable.
`MEMBER_ROLE_ASSIGNMENT_DENIED` (403) rejects unavailable assignments.
`ORGANIZATION_LAST_ADMIN` (400) protects the last builtin administrator.
`MEMBER_ROLES_SAVE_UNAVAILABLE` (503) leaves the write outcome unconfirmed;
read persisted state before retrying. Honor a valid Retry-After on 429/503.
Existing per-role POST/DELETE APIs keep their credential and 204 contracts.

### Build a replacement request

1. Read `GET /members/:userId/roles`. Continue only when `editMode` is `editable`.
2. Capture `member.memberId` as `expectedMemberId` and `aclVersion` as
   `expectedAclVersion` from that same snapshot. Seed your draft from all
   `assignedRoles`, not the paginated `choices` or the list's `rolesPreview`.
3. Send the complete desired set as `roleIds`, including roles outside the current
   search page. An empty array removes every role while preserving membership,
   subject to the last-ADMIN guard.
4. Accept success only after a valid 200 response. Its `changed: false` means a
   locked no-op; `changed: true` means links, ACL revision and audit committed.
   Reread authority before enabling another operation.

For a direct API client, the replacement body has this shape. Replace the
angle-bracket placeholders with IDs from the read; the revision is illustrative:

```json
{
  "expectedMemberId": "<membership-id>",
  "expectedAclVersion": 7,
  "roleIds": ["<existing-role-id>"]
}
```

The path uses the member's **user ID**; `expectedMemberId` is the separate
membership ID. The organization-wide revision can change after another member,
role or permission update, so a conflict does not necessarily mean this member's
assignments changed. A removed/rejoined user has a new membership identity.
Browser integrations should use the public hooks and
[typed BFF transport](../auth/organization-context.md#browser-and-server-transport)
rather than sending bearer credentials from client code.

### Recover after a failed operation

| Outcome                                                                       | Next action                                                                                                                   |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Read failure or deadline                                                      | Retry after any Retry-After delay, or close the editor. Keep an existing dirty draft until explicit review.                   |
| 409 `MEMBER_ROLES_CONFLICT`                                                   | Read current roles and review the new membership/revision before constructing a new draft. Do not replay the stale set.       |
| 400 `ORGANIZATION_LAST_ADMIN`                                                 | Retain the builtin ADMIN assignment or first assign it to another member through an authorized operation.                     |
| 403 denied / 404 unavailable                                                  | Recheck current authority or membership. Do not substitute another organization or assume the member still exists.            |
| 429 rate limit                                                                | Honor Retry-After and deliberately resume only after it expires.                                                              |
| Acknowledged commit, failed follow-up                                         | Treat the write as saved; refresh authority and reads before editing again.                                                   |
| Unconfirmed write: transport failure, deadline, 5xx or invalid acknowledgment | The DB may have committed. Read and compare persisted roles before another deliberate edit; never automatically replay PATCH. |

A reread observes current state; it does not prove that a timed-out write has
finished. A later deliberate Save must use the fresh membership/revision fence
again. Session changes retire the old operation; sign in or reload before using
the new identity.

## Count and byte limits

The replacement JSON parser accepts at most 262144 decoded bytes. Ordinary API
JSON/urlencoded requests retain the 100000-byte default. The BFF independently
bounds decoded request streams at 262144 bytes and response streams/envelopes at
1048576 bytes. API reads accept at most 1048448 bytes to reserve envelope overhead.
Assigned-role snapshots are limited to 524288 serialized UTF-8 JSON bytes, including
Unicode, escaping and metadata; a count limit alone does not bound a response.

Existing memberships with more than 1000 roles return `editMode: oversized`.
Smaller sets exceeding the snapshot/response byte budget return `byteOversized`.
Both return `assignedRoles: null`, the truthful count and paginated choices.
The ready dialog is read-only: it does not truncate assignments or run a sequence
of partial saves. Recovery uses the existing trusted per-role removal API to
reduce a set, or organization role-metadata APIs to reduce excessive metadata,
with their existing authorization. A page that itself exceeds the compact read
budget returns `MEMBER_READ_UNAVAILABLE` (503), rather than a truncated success.
For that read-budget error, an API consumer can narrow search or request a smaller
`limit`; retrying the same oversized response does not reduce its size. The ready
UI and public hooks retain their fixed page size of 20. Builtin roles cannot be
edited through role-metadata APIs; oversized builtin metadata requires a trusted
operator to correct its source. No automatic partial-save recovery is provided.

## Headless integration and customization

`useOrganizationContext` owns one controller for the related blocks. Pass its
`controller` to `useOrganizationMembers` and `useMemberRoleAssignments`, imported
from `@/entities/organization-context`. The latter exposes reads, `busy`, refresh
and structured Save outcomes. The server DAL is the named
`@/entities/organization-context/index.server` public entry. Never import server
operations into client modules or create a competing context owner for a dialog.

Ready routes use `OrganizationMembersMount` from application composition's server
entry. Downstream projects may replace page composition, routes, tables, dialogs
and visual styling, or omit ready UI while retaining headless consumers and typed
BFF routes. Shared primitives remain available with the Operations Console disabled.
No headless module imports Console discovery, ready widgets or a shell. Use the
existing semantic tokens and translation catalogues rather than a competing theme mechanism.

Search/read identity includes session binding, organization, target, committed
search and page. Retire stale async success, failure and cleanup when identities
change. Keep role selection independent of paginated choices. Transport settlement
unblocks authority reads before follow-up settlement; operation busy lasts until
follow-up completes or reaches its deadline. This prevents focus-triggered refresh
from waiting circularly on Save.

Actual role changes persist one `org.member_roles_changed` audit record in the
same transaction as links and the ACL increment. Metadata contains membership ID,
added/removed counts, writer source and credential type, without role names or
full role sets. Parent organization locking coordinates replacement, legacy role
writers, role cascades and invitation membership writes. Cache invalidation follows
commit; primary ACL revision remains authoritative.

During member search and organization authority revalidation the reference list
shows responsive table/card skeletons; an intermediate unconfirmed authority
state is not an availability error. Confirmed access failures remain visible at
the page boundary; failed member reads expose localized errors and retry controls.
Role badges in this list expose existing descriptions on hover or keyboard focus,
with a localized missing-description fallback. The descriptions remain available
in the editor on touch devices. The editor choice region is 256 px on mobile and
up to 400 px (bounded by 45% of viewport height) on desktop; its size stays stable
across searches. These are reference UI choices, not headless layout requirements.

## Remove a member

You need current membership and full TeamAccess in the selected organization.
The action removes organization membership, not the person's account.
In Russian, the actions are **Удалить из организации…**, **Удалить участника**, **Отмена** and **Обновить данные участника**.

1. On **Members**, find the colleague by name or email. Open their row menu and choose **Remove from organization…**.
2. Check the organization, name and email. All the person's keys for this organization will be permanently revoked, including expired keys.
3. Choose **Cancel** to make no request, or **Remove member** to confirm. Rejoining will require new keys.
4. After deleting another member, the success toast and refreshed list confirm completion. Membership and key revocation committed together.
   If the refresh fails or the result is unknown, a persistent message above the list provides recovery.

Removing yourself requires the same authority and displays an additional access-loss warning.
Another member must hold the builtin ADMIN role. A custom role named ADMIN does not qualify.
After successful self-removal, the receipt remains visible with **Back to organizations**.
Expected loss of organization access is part of success. The page hides obsolete member controls
and does not offer membership inspection after confirmed removal. Other refresh failures remain visible.
This does not sign you out or remove memberships or keys in other organizations.
Already admitted requests may finish.

The dialog uses the existing row-menu and confirmation pattern. On narrow or short screens,
the warning scrolls while the final buttons remain reachable. Keyboard focus starts on Cancel.
The permanent-key warning does not depend on key inventory or visibility of own-key settings.

### Refusals and unknown results

The last builtin ADMIN cannot be removed. First assign that builtin role to another member.
At more than1000 unrevoked keys, removal refuses without changing membership, keys, ACL or audit.
The count includes expired keys and all pages. Ask the deployment operator to follow the
[maintenance recovery](../operations/api-key-lifecycle.md#more-than-1000-keys-or-oversized-metadata).
Repeated live batches cannot guarantee completion while issuance continues. Do not delete membership or keys with SQL.

**Refresh member details** is available for an unknown removal result and performs reads; it never repeats removal. It distinguishes an observed original membership,
a different membership, unavailable membership/organization, denied access and read failure.
A still-present membership does not prove the earlier request failed: a delayed writer may still finish.
An unavailable result does not prove this removal succeeded. Refresh member details cannot issue a receipt for a lost response.
A different membership requires selecting the person again from the refreshed list.
A fresh removal always needs its own confirmation and membership identity.

An acknowledged success remains success if the follow-up list or authority refresh fails.
An unconfirmed request shows an unknown-result warning. Never automatically repeat its DELETE.
The notice survives dialog close and list updates in the mounted page. Reload/navigation discards local notices;
leaving the page does not cancel a committed or still-running request. Signing into a different session retires old callbacks.

### Direct API and browser contract

Direct `DELETE /api/v1/organizations/:orgId/members/:userId` remains bodyless and returns empty204.
Optional query `expectedMemberId=<membership-id>` compares the membership under the existing transaction lock,
after live authorization and before effects. A mismatch returns409 `MEMBER_ROLES_CONFLICT`.
Omitting the query retains legacy deletion of the current membership; an old unfenced request can affect a rejoined member.
Use the member list's `memberId`, not the user ID, for the precondition.

Existing400 `BUSINESS_RULE_VIOLATION` means the last builtin ADMIN cannot be removed in this operation.
404 `RESOURCE_NOT_FOUND` means the target/resource is unavailable.409 `MEMBER_API_KEYS_LIMIT` and
`MEMBER_API_KEYS_CONFLICT` are confirmed refusals.503 `MEMBER_API_KEYS_WRITE_UNAVAILABLE`, lost responses,
deadlines and invalid acknowledgments leave the outcome unknown. Honor a valid Retry-After before deliberate recovery.

Browser DELETE uses `/api/product-access/organizations/:id/members/:userId?expectedMemberId=<membership-id>`.
It requires the precondition, exact trusted Origin, session binding and no request body or Content-Encoding.
Duplicate/unknown query fields and unsupported methods are refused. The BFF converts only an exact upstream empty204
into `{binding,data:{removed:true}}`; no bearer reaches the browser. Supported product sessions carry personal JWTs.
Resolver admission and locked authorization require current membership even for SUPER_ADMIN with these credentials.
The legacy direct API's bound-token exception and scoped API-key admission remain unchanged.
This is a supported-issuance guarantee, not validation of arbitrary Redis-injected credentials.

### Custom removal presentation

Import `useMemberRemoval` and `MemberRemovalTarget` from `@/entities/organization-context`.
Pass the existing controller and a frozen `{userId,memberId,email,name?,organizationName?}` target.
Keep the hook owner mounted outside rows that disappear after removal. Do not replace its target while pending
or while an unknown outcome remains unresolved. An inspection reporting a different membership permits
deliberately selecting a fresh target; changing rows alone does not resolve an unknown outcome.
Render your own warning and confirmation before calling `remove()`; the hook does not toast or navigate.

The optional third argument, `onAcknowledged`, reports a validated removal reply before
authority refresh. Use it to retain self-removal feedback when refresh removes access.
It does not grant access or confirm a lost reply; continue to use `outcome` for follow-up state.

| Hook field/action                     | Meaning                                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`, `busy`, `canRemove`        | Bounded command/follow-up state; use canRemove to enable a fresh confirmed action                                                                                 |
| `outcome`                             | committed with followup, rejected/unknown with structured error and possible retryAt, or retired/busy                                                             |
| `inspect()`, `checking`, `inspection` | Read-only authority and exact-user membership observation; same/different includes observed memberId                                                              |
| `retryAt`                             | Shared command/inspection cooldown deadline; disable inspection and new confirmation while present. Expiry enables deliberate recovery, without sending requests. |
| `remove()`                            | Executes one explicitly confirmed removal; never retries automatically                                                                                            |

Commands use a20-second browser and15-second BFF deadline plus a separate bounded5-second follow-up.
Inspection bounds authority refresh at5seconds and its exact-user read at20seconds.
The named server entry exports `removeOrganizationMember(orgId,userId,{expectedMemberId},input)`;
input has `expectedSession`, `headers` and optional `signal`, as for other context operations.
It returns the typed acknowledgment envelope. Keep it server-only and supply the mutation Origin check in the route adapter.

The address above uses default path placement. For the staff-host address or a
custom alias, see [placement and sessions](placement-and-sessions.md).

For a distinct visual style, change product-owned JSX, CSS and semantic token values.
See [Your own appearance](adoption.md#your-own-appearance) for portal, contrast and
state requirements. Headless operations do not require the ready page's visual design.
