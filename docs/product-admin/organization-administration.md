# Add and recover organization administrators

A platform `SUPER_ADMIN` can invite administrators or explicitly give administrator
access to an existing verified member. Several people can be administrators.
The operator receives no membership automatically. Organization `ADMIN` gives
organization access, not platform `SUPER_ADMIN` access.

These operations require the deployed administrator-invitation migration,
initialized canonical system roles, a live personal `SUPER_ADMIN` session and
recent authentication. The first trusted platform account remains a separate
[deployment prerequisite](../auth/rbac.md#administering-super_admin). These commands
never repair system permissions or reopen a completed initial setup.

```text
New person -> Invite -> Verify email -> Explicitly accept -> Organization ADMIN
Existing member -> Select exact member -> Confirm ADMIN assignment -> Organization ADMIN
Cancelled initial invitation -> New invitation or member assignment -> Organization ADMIN
```

<!-- AMCORE_CONSOLE_ADMINISTRATION_START -->

## Use Console

Open **Organizations**. **Create organization** starts a new organization.
**Needs attention** lists organizations without an administrator or with unfinished
administrator invitations. This list belongs to the server, not the last browser
or operator. It includes expired invitations and invitations whose old recipient
data has been removed. Open an organization by its name to continue.

The organization page shows its current administrators in a separate paginated
list. Historical invitation completion does not prove that those rights still
exist. A removed administrator disappears from the current list.

1. Choose **Invite an administrator** to invite a new person.
2. Enter the recipient email, email language and an operational reason.
3. Check the organization and recipient. Confirm **Send invitation**.
4. Ask the recipient to follow their email, verify their mailbox and explicitly
   accept. Refresh the organization to see current administrators and invitations.

New-account invitation registration works with public signup disabled. Existing
accounts keep their credentials. An existing account uses its preferred language;
the selected language supplies the default for a new account.

While the original first-administrator invitation is unfinished, use its reissue,
recipient replacement or cancellation controls. Do not start a competing additional
invitation. After it ends, a new administrator invitation is a separate action.

To give an existing member access, find them using the member search below the
administrator section. **Make administrator** selects the current user and
membership IDs. Enter the reason, check the person and organization, then confirm.
The server requires verified email and checks membership and access versions again.
The assignment confirmation warns that an awaiting original first-administrator
invitation will end and its old link will stop, even for a different recipient.
Other roles and administrators remain. A concurrent membership/access change
requires a fresh selection. The email address alone never substitutes a person.
If the recipient became an ordinary member before accepting, their page explains
that an operator must separately confirm administrator assignment. The API returns
`409 PROVISIONING_ADMIN_CONFLICT` for the initial invite or
`409 ADMIN_MEMBER_ASSIGNMENT_REQUIRED` for an additional one; no invitation claim
or implicit promotion occurs. After the operator assigns the exact member, use
current ADMIN state; an old invitation link is not needed to apply that grant.

**Change recipient** opens a dialog. Closing or going back sends nothing.
**Cancel invitation** explains that its link will stop working. Its final
confirmation uses destructive styling. Cancellation retains the organization,
other invitations and existing administrators. A new invitation can later restore
a working administration journey; the cancelled invitation itself stays closed.

Console's general organization search is separate from this attention list.

The **Needs attention** list refreshes every 30 seconds while its browser tab is
visible. **Refresh list** reads it immediately; it does not send invitations.
The page shows when the list last updated. A read failure stops periodic checks;
use **Refresh list** to retry after resolving the error. A successful retry resumes
the 30-second automatic checks. These reads cover the
current page and never execute invitation commands. After a failed read, Console
shows an error and hides previous rows until a successful read; this is not a
successful empty result. The timestamp remains the last successful read.

<!-- AMCORE_CONSOLE_ADMINISTRATION_END -->

## Recover a problem

| Situation                                    | Action                                                                         | Result                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Two organizations await acceptance           | Open each row in **Needs attention**                                           | Both remain discoverable across reloads and operators          |
| Invitation not accepted yet                  | Refresh; ask the recipient to check inbox/spam                                 | Reads do not send another email                                |
| Wrong address                                | Change recipient and confirm                                                   | Old link stops working; new person must accept                 |
| Expired link                                 | Send a new invitation explicitly                                               | New validity period; previous link stops working               |
| Old address removed by retention             | Choose a recipient again                                                       | Same organization and intent; explicit new email               |
| Cancelled first invitation, no administrator | Invite an administrator with a new request                                     | Old initial history remains cancelled                          |
| Recipient became an ordinary member          | Select that member and confirm administrator assignment                        | No silent elevation during invitation acceptance               |
| Response lost                                | Check the saved request; repeat identical input under the same ID if available | No duplicate grant or automatic resend                         |
| Rights removed after completion              | Review the current member and make a new explicit decision                     | Old replay never restores removed rights                       |
| Account or membership deleted                | Select the current member again, or invite a new recipient                     | Same email does not select a replacement account automatically |
| Real provider fails after commit             | Repair email configuration, then explicitly reissue                            | Organization and unfinished invitation remain                  |

Production with `EMAIL_PROVIDER=mock` refuses new invitation sends before domain
writes or mail quota. Configure the real provider described in
[organization provisioning](organization-provisioning.md). Cancellation and member
assignment do not depend on email readiness or the email-rate Redis admission.
Development mock mode states that no actual email was sent. A provider acknowledgment
never proves delivery to the inbox. A failed read never confirms acceptance.

## Use the backend without Console

Disabling Console removes its frontend, not these backend APIs or the product
recipient journey. Paths below are relative to `/api/v1`. Use a personal bearer
session with current platform `SUPER_ADMIN`, never an API key or organization
context token. Writes require recent authentication. Use existing password step-up
or a new supported interactive OAuth login when required.

Save a fresh UUIDv7 operation ID and exact input before each deliberate command.
Generate an ID with the runtime command shown in the provisioning guide. Keep the
same ID and input for a retry after a lost response. Never put tokens in URLs,
logs or shared terminal output.

Read current state. [Response examples](organization-provisioning-responses.md)
show complete sample shapes, including `aclVersion` and the current ADMIN list:

```http
GET /api/v1/admin/organizations/attention?page=1&limit=20
Authorization: Bearer <personal-super-admin-access-token>

GET /api/v1/admin/organizations/<organization-id>/administration?adminPage=1&invitationPage=1&limit=20
Authorization: Bearer <personal-super-admin-access-token>
```

The attention response uses separate counts: `organizationTotal` is all existing
organizations, including those that need no action; `total` is the number needing
attention after the optional API `search` filter; `data` is only the requested
page. For example, 10 organizations with 3 needing attention yield
`organizationTotal:10`, `total:3`; a page limit of 2 returns 2 rows.
`pendingAdminInvitationCount` counts awaiting managed intents,
including expired and pruned ones. Completed/cancelled intents and ordinary
unmarked invitations count zero. A no-administrator organization with zero
unfinished intents still needs attention. Counts describe organizations, not pages.

A headless client may read the paginated attention endpoint on demand, refresh on
return to the screen, or poll while visible (30 seconds is a reasonable starting
interval). Stop on authority/rate-limit errors and respect `Retry-After`; reads
never send invitations. No headless polling SDK or mandatory interval is provided.

Invite an additional administrator:

```http
POST /api/v1/admin/organizations/<organization-id>/administrator-invitations
Authorization: Bearer <personal-super-admin-access-token>
Content-Type: application/json

{
  "operationId": "<saved-UUIDv7>",
  "email": "anna@example.test",
  "inviteLocale": "en",
  "reason": "Support request TEST-49"
}
```

`201` returns `operationId`, `organizationId`, `administratorInvitationId` and
`revision`. This confirms the saved invitation, not mailbox delivery or access.
Exact retained replay returns its original receipt and sends no email.

To promote an existing member, first use the existing protected organization
member search, `GET /admin/organizations/<organization-id>?page=1&limit=20&search=anna`.
Read the selected `user.id` and `memberId`. Read the current `aclVersion` from
`GET …/administration`. Never invent a membership ID from the user ID or email.
Deploy matching frontend/backend versions; older member projections may omit
`memberId` and cannot support this selection.

```http
POST /api/v1/admin/organizations/<organization-id>/administrators
Authorization: Bearer <personal-super-admin-access-token>
Content-Type: application/json

{
  "operationId": "<new-saved-UUIDv7>",
  "userId": "<selected-user-id>",
  "expectedMemberId": "<selected-membership-id>",
  "expectedAclVersion": 4,
  "reason": "Support request TEST-50"
}
```

`200` returns the actual grant ID, member/user IDs, resulting `aclVersion` and
`changed`. An already ADMIN member can be acknowledged without another grant.
Assignment closes an awaiting original first-administrator process in this
organization, even if its invited recipient was somebody else. Its current link
is revoked, and completion records the selected member's actual ADMIN grant.
For additional invitations, only awaiting intents whose CURRENT retained
invitation email canonically equals the selected user's email are completed;
their links are revoked too. An intent whose recipient was pruned cannot match
by an old address and remains awaiting. Additional invitations for other
recipients remain awaiting and their links remain usable until expiry, revocation
or another normal validity change. No completed/cancelled history is rewritten.

An exact retained assignment replay returns HTTP 200 and the SAME original body,
including its historical `aclVersion` and `changed`. It is checked before current
member/ACL comparisons, under current operator authority/freshness. Removing ADMIN
later does not change this receipt or restore the grant. Changing any saved input,
including `expectedAclVersion` or reason, under the same ID returns
`409 ADMIN_INTENT_MISMATCH`. After receipt retention, an old ID cannot start again
(`409 ADMIN_OPERATION_EXPIRED`). A new explicit grant needs a new ID and current
member/ACL selection. A deleted-and-recreated membership has a new `memberId`;
the old selection is never substituted, even for the same email. `changed` in a
replayed receipt describes that ORIGINAL command; even `changed:true` is not
current access proof. Always read the current summary after replay. Do not label
an old receipt as a new grant.

| Action                    | Endpoint and input                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect additional intent | `GET …/administrator-invitations/:id`                                                                                                 |
| Reissue                   | `POST …/administrator-invitations/:id/reissue`: `operationId`, `expectedRevision`, `expectedInviteId`, `expectedGeneration`, `reason` |
| Replace recipient         | `POST …/administrator-invitations/:id/replace-recipient`: `operationId`, `expectedRevision`, `email`, `inviteLocale`, `reason`        |
| Cancel                    | `POST …/administrator-invitations/:id/cancel`: `operationId`, `expectedRevision`, `reason`                                            |
| Recover own command       | `GET …/administrator-operations/:operationId`                                                                                         |

Recovery commands return `200` with their operation/organization/intent IDs and
revision. Operation lookup returns `committed` with the safe receipt or `unknown` with `expiredUnrecorded`.
Only `expiredUnrecorded=true`, checked after both operation locks and database-time
expiry, proves that this absent expired request can no longer start. Only with that
proof may the operator discard the unresolved request and choose a new action.
Fresh unknown or future-clock IDs never receive this terminal negative proof.
Unknown is not an instruction to repeat with a new ID. Another operator reads
current organization state and makes a separate explicit action with a new reason.
Receipts are actor-bound. No status API returns secret recipient links or reasons.

A pending ordinary unmarked invitation for the same address returns
`ADMIN_INVITATION_ALREADY_PENDING` with its bounded ID/generation. After checking
its consequences, create a NEW platform request with `supersedesInvite` containing
that exact `id` and `generation`. This revokes the old link and issues fixed ADMIN
intent. Both original and additional managed invitations refuse this override.
Use their own controls instead. Ordinary managers cannot create, reissue or revoke
active managed administrator invitations; their existing committed replay remains
read-only. Ordinary unmarked behavior and `TeamAccess` remain unchanged.

For an exact unmarked supersession, after inspecting the conflict, send this NEW
request. Substitute the exact ordinary invitation ID/generation from the conflict:

```http
POST /api/v1/admin/organizations/<organization-id>/administrator-invitations
Authorization: Bearer <personal-super-admin-access-token>
Content-Type: application/json

{
  "operationId": "<new-saved-UUIDv7>",
  "email": "anna@example.test",
  "inviteLocale": "en",
  "reason": "Support request TEST-51",
  "supersedesInvite": {"id":"<exact-ordinary-invite-id>","generation":1}
}
```

This override is unavailable for either managed type. Ordinary invitation
management still requires current membership and full `manage:TeamAccess`.
With that authority it can select assignable system ADMIN in an UNMARKED ordinary
invitation; this does not confer platform SUPER_ADMIN. It cannot bypass the active
managed-owner guard by using the same email or by changing roles. Fresh attempts
receive `409 PROVISIONING_MANAGED` before quota/writes, even for expired managed
links; the UI shows an error rather than granting the ordinary user Console access.
Ask an authorized platform operator to use the platform actions. Managed invitations
appear in the ordinary list while their current underlying invitation satisfies its
pending/expired filters; that list does not add a separate managed badge or hide
all controls. Attempting a protected write still refuses on the server.

After actual recipient pruning, there is no underlying invitation/address to match:
ordinary list/reissue/revoke cannot target that deleted invite ID, and ordinary
create no longer reserves its erased email. The minimal awaiting managed intent
still appears in attention and can be recovered by the platform operator. If an ordinary invite now exists for the newly entered address, replacement of
the old managed intent refuses that collision. The platform operator can deliberately
cancel the old awaiting managed intent, then issue a NEW additional invitation with
exact unmarked supersession. If the old intent is initial, cancel it first before
additional creation becomes available. Do not add supersedesInvite to a replacement
DTO. This preserves the organization and does not reopen the cancelled history.
If no conflicting invitation exists, the operator can replace the recipient with
the explicitly entered address, including the former erased address. An ordinary
manager may instead revoke a retained unmarked invitation using their existing
permissions and current generation. This does not cancel either managed intent.

After a managed intent is cancelled, that guard no longer reserves the address.
An authorized ordinary manager may create an unmarked invitation under ordinary
rules. This does not reopen the cancelled process. Ordinary acceptance for an
already existing member still preserves roles; use explicit platform assignment
to promote that member through this platform recovery workflow. Existing full-TeamAccess
member-role tools can also assign organization ADMIN under their unchanged authority;
that separate ordinary role change does not itself close a managed provisioning intent.
Do not infer invitation completion from the role change.
See [ordinary invitation authority](../auth/invites.md).

### Refusals and the original recipient

If the selected membership disappeared, assignment returns
`409 ADMIN_MEMBER_UNAVAILABLE`; a changed access version returns
`409 ADMIN_ASSIGNMENT_CONFLICT`. Neither refusal grants access. Read current members
again, select the intended current member and submit a NEW operation with its current
membership ID and access version. Never replace the identity by email.

After a different member is assigned and the initial link is revoked, the original
recipient cannot accept that old link. Inspecting it returns an unusable/invalid
invitation; the product page offers the unusable-link guidance rather than joining.
That recipient gets no rights from somebody else's assignment. Operator status
and the current ADMIN list identify who actually received access.

## Security and retained data

New invitation sends share the existing 3/hour organization+recipient, 30/hour
operator+organization and 30/hour platform-operator counters. The 250 ms application
deadline bounds Redis admission. A late reply cannot continue SQL writes; Redis
may still consume quota. Cancellation and explicit member assignment use no mail quota.

The additional intent stores IDs, a fingerprint, revision and bounded mail
attempt facts. It stores no plaintext email, reason, token or rendered message.
An unaccepted/unrevoked underlying invitation becomes eligible for pruning 30 days
AFTER its expiry; accepted invitations 30 days after acceptance, revoked invitations
30 days after revocation. Actual removal waits for the cleanup job. The awaiting
intent survives this recipient removal. Choose a recipient again for an awaiting
intent; send a NEW invitation for a cancelled one. Terminal additional intents
become eligible 30 days after completion/cancellation. Command receipts become
eligible 30 days after the command completed. These are different retention clocks.
An unknown UUIDv7 older than 24 hours cannot start a command; future skew is limited
to 5 minutes. Original organization-creation receipts remain permanent.

### Operational reasons and who can read them

`reason` is required for additional administrator invitation create, reissue,
recipient replacement and cancellation, and explicit member assignment. It is NOT
a field of organization create-and-invite or its initial-invitation recovery DTOs.
Do not add it to those strict requests. Recipient acceptance needs no operator reason.

The value must contain 1–500 trimmed characters, at most 2000 UTF-8 bytes and no
control characters. It is saved in SECURITY audit metadata. Current audit reads
require a live personal platform SUPER_ADMIN, not organization ADMIN or an API key.
In practical terms, the raw stored reason is available to authorized database/
backup administrators, not through the Console API even to SUPER_ADMIN.
The existing Console audit API returns a redacted projection; it does NOT currently
expose the raw reason for these organization-administrator events. There is no
built-in raw-audit export endpoint. Authorized database/backup administrators can
read retained metadata under deployment policy. Audit has no automatic pruning
job; invitation/receipt 30-day retention does not erase its reason. See
[audit read access](../operations/audit-log.md#read-access) and its retention policy.

While an additional command is unresolved, the browser also keeps its frozen
reason/input in origin-local `localStorage`, bound to that actor and organization.
The next admitted page mount after 24 hours rewrites it without the frozen input,
retaining only the operation reference; completed recovery clears it. This is
read-time cleanup, not guaranteed disk deletion while the browser is closed.
Headless clients must protect their own saved retry input similarly.

Status, attention, receipts, application logs, mail and notifications exclude the
reason. Validation does not remove sensitive content automatically. Enter ticket
references or operational justification without secrets or personal information.
