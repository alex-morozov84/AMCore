# Organization members and role assignment

Open `/organizations/[id]/members` (with the locale prefix in multi-locale builds)
from the **Members** navigation tab on the organization overview. Overview keeps
the Organization and Your access cards; Members shows the member list. Both
sections retain the organization heading and route-backed navigation, supporting
direct links, reload and browser Back/Forward. The signed-in user must currently
belong to that organization and have full TeamAccess. Being a platform
super-administrator does not waive membership on these endpoints. API keys cannot
use the member list, role snapshot or full replacement endpoints.

The members tab can be narrowed to the holders of one role with `?role=<roleId>` (the role page links
there). Role-definition editing (see the [Roles tab](role-definitions.md#ready-role-screens)), invitations and member removal are separate workflows;
this page changes assignments of existing roles only. For route placement and a
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
existing semantic tokens and translation catalogues rather than a second theme.

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
