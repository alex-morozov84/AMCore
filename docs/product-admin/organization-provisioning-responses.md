# Organization provisioning response examples

These examples use test identities and placeholders. Replace placeholders with
values from the actual response. Backend paths include `/api/v1`; a Console BFF
may wrap these data with its browser-session binding. These are observations,
not commands that send mail or grant access. OpenAPI at `/docs` is the full contract.

## First-administrator progress

**Check invitation acceptance** reads
`GET /api/v1/admin/organizations/<organization-id>/provisioning`.
A pending response is:

```json
{
  "organizationId": "<organization-id>",
  "creationOperationId": "<saved-UUIDv7>",
  "available": true,
  "revision": 1,
  "state": "awaiting",
  "invite": {
    "id": "<current-invite-id>",
    "generation": 1,
    "email": "anna@example.test",
    "expiresAt": "2026-10-24T12:00:00.000Z",
    "status": "pending"
  },
  "completedAt": null,
  "cancelledAt": null,
  "access": "not_established",
  "mailOutcome": "provider_acknowledged",
  "policy": { "role": "ADMIN", "mailMode": "provider", "createAllowed": true }
}
```

Reissue uses `revision`, `invite.id` and `invite.generation` from THIS response.
Do not use `creationOperationId` as a new recovery-command ID. `invite:null` means
no current recipient projection; consult `state`: awaiting needs explicit recipient
replacement, cancelled needs a NEW administrator invitation. A cancelled current
invitation is revoked in the same command, so its retained underlying row uses the
revocation-time retention clock. Cancellation never deletes the organization.

`state:"completed"` reports historical completion. Inspect current ADMINs separately;
`access` reports the original grant, not every administrator. `available:false`
means the original organization is unavailable, not permission to recreate it.

## Current administrators and access version

`GET /api/v1/admin/organizations/<organization-id>/administration`
returns independently paginated current ADMINs and awaiting additional invitations:

```json
{
  "organizationId": "<organization-id>",
  "name": "North shop",
  "aclVersion": 4,
  "checkedAt": "2026-10-17T12:00:00.000Z",
  "policy": { "role": "ADMIN", "mailMode": "provider", "createAllowed": true },
  "administrators": {
    "total": 1,
    "data": [
      {
        "userId": "<anna-user-id>",
        "memberId": "<anna-member-id>",
        "name": "Anna",
        "email": "anna@example.test"
      }
    ]
  },
  "invitations": { "total": 0, "data": [] },
  "initial": null
}
```

For member assignment, read the selected current `user.id`/`memberId` from the
protected member search and THIS `aclVersion` for `expectedAclVersion`.
`initial` is null when this organization has no operator first-invitation history;
otherwise it has the progress shape above, including terminal history.

After replaying an old assignment, read this summary again. A receipt may say
`changed:true` because the ORIGINAL operation changed access; it does not prove
the person is still an ADMIN. Only current membership/ADMIN data describes now.

## Organizations needing attention

`GET /api/v1/admin/organizations/attention?page=1&limit=20`:

```json
{
  "organizationTotal": 10,
  "total": 1,
  "page": 1,
  "limit": 20,
  "data": [
    {
      "organizationId": "<organization-id>",
      "name": "North shop",
      "slug": "north-shop",
      "adminCount": 0,
      "pendingAdminInvitationCount": 1,
      "reasons": ["no_administrator", "pending"]
    }
  ]
}
```

There are 10 organizations overall and 1 matching attention organization.
`data` contains the current page, not all organizations. API `search` narrows
attention `total`; the general Console search does not filter this separate list.
See [attention behavior](organization-administration.md#use-console) for reads/errors.

## Initial setup status

Bootstrap has one permanent installation result. It needs no caller-generated
operation ID. Read it without repeating the bootstrap write:
`GET /api/v1/admin/organization-establishment/status`.

```json
{
  "state": "completed-intact",
  "ids": {
    "organizationId": "<original-organization-id>",
    "userId": "<original-user-id>",
    "memberId": "<original-member-id>",
    "adminRoleId": "<original-admin-role-id>",
    "adminGrantId": "<original-admin-grant-id>"
  },
  "completedAt": "2026-10-17T12:00:00.000Z"
}
```

Other examples are `{"state":"eligible-empty"}` and
`{"state":"not-ready","reason":"creation-enabled"}`. `completed-changed`
retains the original IDs/time but does not authorize repairing access by replay.
An organization inventory row has no setup-origin badge; compare its ID with this
result. An unavailable read proves neither rollback nor eligibility. For an
unresolved initial action, follow [setup recovery](organization-establishment.md#state-and-recovery-reference).

## Additional invitation progress

`GET /api/v1/admin/organizations/<organization-id>/administrator-invitations/<intent-id>`:

```json
{
  "id": "<administrator-intent-UUIDv7>",
  "organizationId": "<organization-id>",
  "revision": 1,
  "state": "awaiting",
  "invite": {
    "id": "<current-invite-id>",
    "generation": 1,
    "email": "anna@example.test",
    "expiresAt": "2026-10-24T12:00:00.000Z",
    "status": "pending"
  },
  "completedAt": null,
  "cancelledAt": null,
  "mailOutcome": "provider_acknowledged"
}
```

The path uses the additional intent's `id`; reissue also uses `invite.id` and
`invite.generation`. These are different identities. Cancellation/replacement
requires this intent's `revision`, a new command ID and the operational reason.
