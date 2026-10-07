# Role definitions API

Organization administrators manage custom roles through **role definitions**: a role's
metadata and its complete selection of catalogue presets, saved as one atomic command and
fenced by the organization revision. This guide documents the API and headless contract. A
ready role-editor screen is not part of this release; build your own presentation on these
routes, and keep reading the [capability catalogue](../auth/capability-catalogue.md) to
register the operations your product offers.

## Who may use it

All routes are under `/api/v1/organizations/:orgId/role-definitions` and require **bearer**
authentication, **current membership** in the organization (including for a platform
SUPER_ADMIN) and **full TeamAccess**. API keys are refused. The legacy `/roles` routes keep
their paths, credentials and shapes (see [Legacy role routes](#legacy-role-routes)).

## Routes

| Route                                     | Purpose                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /role-definitions`                   | Page of roles with organization-local holder counts, rule counts and advanced-rule state   |
| `GET /role-definitions/:roleId`           | One role as an atomic snapshot: metadata, managed presets, advanced rules, holders, impact |
| `POST /role-definitions`                  | Create an empty custom role (`201`)                                                        |
| `PATCH /role-definitions/:roleId`         | Save the complete definition: name, description and the full preset selection (`200`)      |
| `POST /role-definitions/:roleId/deletion` | Delete a custom role after confirming the people and invitations affected (`200`)          |

Use the development OpenAPI document at `/docs` for exact schemas. Lists default to page 1
and limit 20 (maximum 100); `search` is a literal, case-insensitive role-name substring of at
most 100 Unicode code points. Roles are ordered built-in first, then by name.

### Read a role

`GET /role-definitions/:roleId` returns, from one `RepeatableRead` snapshot:

- `role` (id, name, description, `isSystem`) — never the permission rows;
- `aclVersion` — the organization revision you must send back when you save or delete;
- `editMode`: `editable`, `system` (built-in; readable, never writable) or `oversized`;
- `selfHeld` — the calling user currently holds this role;
- `grantsFullControl` — a stored, non-inverted `manage:TeamAccess` rule exists. This is
  **configured** authority, not the effective decision: a DENY elsewhere can still veto it;
- `managedPresets` — rules the editor recognizes as exact catalogue presets (with the
  permission ids and a `duplicateCount`), and `advancedRules` — everything else, to be shown
  read-only (conditions, field restrictions, DENY). Both are `null` when `editMode` is
  `oversized` (more than 200 rules or more than 256 KiB of serialized rules), with a truthful
  `ruleCount`;
- `holders` — this organization's holder `total`, a deterministic sample of at most 10 members
  and `truncated`;
- `impact.liveInvitationCount` — pending, unexpired invitations that still target the role.

The snapshot is atomic: a failure or over-budget read is a single `503 ROLE_READ_UNAVAILABLE`
and the whole definition is unavailable; there is no independently failing sample.

### Save a definition

```json
{
  "expectedAclVersion": 7,
  "name": "Support lead",
  "description": null,
  "presets": [
    { "capabilityId": "organization.read", "presetId": "own" },
    { "capabilityId": "organization.update", "presetId": "own" }
  ],
  "acknowledgeFullControl": true,
  "acknowledgeSelfHeld": true
}
```

One transaction locks the organization, compares `expectedAclVersion`, applies the change,
raises the revision once, writes one audit event and returns `{detail, changed}` built from
the post-write state. The server **preserves** every rule it does not manage — advanced
rules, DENY rules and unchanged preset rows keep their ids. Deselecting a preset detaches
all of its duplicate rows from this role only; a permission row shared with another role is
kept for that role and collected only when no role links it any more. A save that changes
nothing validates the fence but writes no row, revision or audit event and returns
`changed: false`.

Acknowledgments are interaction controls enforced by the server, not a delegation limit:

- `acknowledgeFullControl` is required when the save **adds** a preset whose catalogue
  descriptor carries `risk: "fullControl"` (today `teamAccess.manage`).
- `acknowledgeSelfHeld` is required when you hold the role and the preset set changes, or when
  you delete it. Editing only the name or description of a role you hold needs no
  acknowledgment.

The name and description you send are compared to the stored values **as raw text**. If they
are unchanged they are preserved verbatim, so a historical name such as `" ADMIN "` stays
saveable when only presets change. A changed name is trimmed (2–50 characters) and must not
be `ADMIN`, `MEMBER` or `VIEWER` (case-insensitive) or collide, ignoring case, with another
role of the organization. A changed description is trimmed; an empty one becomes `null`.

### Delete a role

```json
{ "expectedAclVersion": 8, "expectedLiveInvitationCount": 1, "acknowledgeSelfHeld": true }
```

Holders lose the role, and live invitations that targeted it lose that role intent; no other
role is substituted. If the revision or the live-invitation count differs when the command
runs under the organization lock (including because an invitation expired), the server
answers `409 ROLE_DELETE_IMPACT_CHANGED` or `ROLE_DEFINITION_CONFLICT`; read the role again
and confirm the new impact. "Affects N people" counts current holders; it does not prove that
N people's effective access changes, because their other roles may keep or veto it.

## Errors

| Status | Code                             | Meaning                                                                |
| ------ | -------------------------------- | ---------------------------------------------------------------------- |
| 400    | `CAPABILITY_UNSUPPORTED`         | Unknown capability/preset pair                                         |
| 400    | `ROLE_NAME_RESERVED`             | A new or changed name is a built-in role name                          |
| 400    | `ROLE_FULL_CONTROL_ACK_REQUIRED` | Adding full control without `acknowledgeFullControl`                   |
| 400    | `ROLE_SELF_HELD_ACK_REQUIRED`    | Changing/deleting a role you hold without `acknowledgeSelfHeld`        |
| 403    | `ROLE_SYSTEM_IMMUTABLE`          | Writing a built-in role                                                |
| 404    | `ROLE_UNAVAILABLE`               | Missing, foreign or unassignable role (no foreign metadata is exposed) |
| 409    | `ROLE_DEFINITION_CONFLICT`       | The organization revision changed since the definition was read        |
| 409    | `ROLE_NAME_CONFLICT`             | Another role already uses the name                                     |
| 409    | `ROLE_DEFINITION_OVERSIZED`      | The current or resulting definition exceeds the editable budget        |
| 409    | `ROLE_DELETE_IMPACT_CHANGED`     | The live-invitation count differs from the confirmed one               |
| 413    | `PAYLOAD_TOO_LARGE`              | Decoded request body over 16,384 bytes                                 |
| 503    | `ROLE_READ_UNAVAILABLE`          | A read exceeded its response budget                                    |
| 503    | `ROLE_SAVE_UNAVAILABLE`          | The write outcome is unconfirmed                                       |

### Recover from an unconfirmed write

Create, save and delete are **never replayed automatically**. After `ROLE_SAVE_UNAVAILABLE`,
a transport failure or a lost response the database may have committed:

- **Create:** search the role list by the entered name and compare exact trimmed,
  case-insensitive matches. A match proves a role with that name exists, not that your
  uncertain command created it.
- **Save:** read the role and compare it with your draft; send a new save with the fresh
  `aclVersion` only as a deliberate edit.
- **Delete:** read the role; `404 ROLE_UNAVAILABLE` means it no longer exists, which is not
  proof that this command removed it.

An acknowledged save stays saved even if the follow-up read denies you — for example after you
removed your own full control. Treat that as "saved; your access changed", not as a failure.

## Limits

| Limit                                              | Value                                     |
| -------------------------------------------------- | ----------------------------------------- |
| Request body (create, save, delete), decoded bytes | 16,384                                    |
| Preset selection per save                          | 64 unique `capabilityId`/`presetId` pairs |
| Editable rules per role                            | 200 rules and 256 KiB of serialized rules |
| List response / detail response (API)              | 261,120 / 785,408 bytes                   |
| Holder sample                                      | 10 members                                |
| List offset                                        | `(page − 1) × limit` ≤ 100,000            |

The web BFF caps responses 1,024 bytes higher than the API so that an API response at its own
limit still fits the `{binding, data}` envelope. Counts are preflighted from metadata before
any rule payload is read, so an oversized role is recognized without materializing its rules.
A list page reports `advancedState: "unknown"` for roles outside its per-page classification
budget (2,000 rows / 512 KiB) instead of reading an unbounded set of rules.

## Audit

Each changed definition writes one `org.role_created`, `org.role_updated` or
`org.role_deleted` event **in the same transaction** as the change, targeting the
organization. Metadata holds the role id, the organization revision before and after, preset
counts, whether full control was added or removed, holder and invitation counts and whether
the name or description changed — never a name, description, condition or email. An audit
failure rolls the whole command back. The credential type is `jwt` for these routes and the
real credential type for the legacy routes.

## Legacy role routes

`/roles`, `/roles/:roleId` and `/roles/:roleId/permissions*` keep their paths, credentials,
request and response shapes. They now share the same serialization: every state-changing call
locks the organization, raises the revision once and writes the same audit event
(`source: "legacy"`), so no older writer can change a role without the fence the definition
routes rely on. Removing a permission from a role detaches only that role's link; the
permission row itself is deleted only when no role references it any more. Naming keeps its
documented case-sensitive semantics on the legacy routes; only the definition routes reject
case-insensitive collisions, and historical collisions that already exist stay saveable.

## Build your own editor

1. Read `GET /organizations/:orgId/capabilities` for the supported operations, presets and
   the `risk` flag, and render labels from your own translation catalogue.
2. List roles, open one, and seed your draft from `managedPresets`; show `advancedRules`
   read-only and never send them back — the server keeps them.
3. Keep the role's `aclVersion` and send the **complete** preset selection on save.
4. Require your own confirmation UI for `risk: "fullControl"` and for `selfHeld`, then send
   the acknowledgment flags.
5. Treat `ROLE_DEFINITION_CONFLICT` as "re-read and review", never replay a stale save.
