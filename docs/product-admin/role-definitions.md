# Role definitions API

Organization administrators manage custom roles through **role definitions**: a role's
metadata and its complete selection of catalogue presets, saved as one atomic command and
fenced by the organization revision. This guide documents the API, the headless contract and
the [ready Roles screens](#ready-role-screens) built on them. Use the ready screens as they are,
replace their presentation, or build your own on the same entity hooks; keep reading the
[capability catalogue](../auth/capability-catalogue.md) to register the operations your product
offers.

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
kept for that role and collected only when no role links it any more. A save whose
**resulting** definition equals the stored one — including a draft that differs only by
surrounding whitespace or an empty description, which normalizes to the stored values —
validates the fence but writes no row, revision or audit event and returns `changed: false`.
A save is also refused with `ROLE_DEFINITION_OVERSIZED`, before anything is committed, when
the role's actual advanced-rule projection already exceeds its budget, when the change would
push it over, or when the response itself would exceed the response budget (for example
because holder names are unusually long); that applies to an unchanged save as well.

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

| Status | Code                             | Meaning                                                                    |
| ------ | -------------------------------- | -------------------------------------------------------------------------- |
| 400    | `CAPABILITY_UNSUPPORTED`         | Unknown capability/preset pair                                             |
| 400    | `BAD_REQUEST`                    | A changed name is shorter than 2 or longer than 50 characters once trimmed |
| 400    | `ROLE_NAME_RESERVED`             | A new or changed name is a built-in role name                              |
| 400    | `ROLE_FULL_CONTROL_ACK_REQUIRED` | Adding full control without `acknowledgeFullControl`                       |
| 400    | `ROLE_SELF_HELD_ACK_REQUIRED`    | Changing/deleting a role you hold without `acknowledgeSelfHeld`            |
| 403    | `ROLE_SYSTEM_IMMUTABLE`          | Writing a built-in role                                                    |
| 404    | `ROLE_UNAVAILABLE`               | Missing, foreign or unassignable role (no foreign metadata is exposed)     |
| 409    | `ROLE_DEFINITION_CONFLICT`       | The organization revision changed since the definition was read            |
| 409    | `ROLE_NAME_CONFLICT`             | Another role already uses the name                                         |
| 409    | `ROLE_DEFINITION_OVERSIZED`      | The current or resulting definition exceeds the editable budget            |
| 409    | `ROLE_DELETE_IMPACT_CHANGED`     | The live-invitation count differs from the confirmed one                   |
| 413    | `PAYLOAD_TOO_LARGE`              | Decoded request body over 16,384 bytes                                     |
| 503    | `ROLE_READ_UNAVAILABLE`          | Any read failure: a response over its budget or an infrastructure fault    |
| 503    | `ROLE_SAVE_UNAVAILABLE`          | The write outcome is unconfirmed                                           |

`403` on a write names `ROLE_SYSTEM_IMMUTABLE` for a built-in role; the same status without
that code means current membership or full TeamAccess is missing. A built-in role is readable
but never writable.

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

The 16,384-byte request cap is decoded size and covers every accepted spelling of these paths
(trailing slash, letter case, percent-encoded ids) and both JSON and form bodies, including
compressed requests after inflation; a request over it answers `413` before any handler runs.

The web BFF caps responses 1,024 bytes higher than the API so that an API response at its own
limit still fits the `{binding, data}` envelope. Counts are preflighted from metadata before
any rule payload is read, so an oversized role is recognized without materializing its rules.
A list page reports `advancedState: "unknown"` for roles outside its per-page classification
budget (2,000 rows / 512 KiB) instead of reading an unbounded set of rules.

## Upgrading an existing installation

The release that adds these routes also adds one index, `member_roles_roleId_memberId_idx` on
`core.member_roles ("roleId", "memberId")`. It serves holder counts and samples and the
foreign-key lookup that runs when a role is deleted (the existing unique index starts with
`memberId`). Building a plain `CREATE INDEX` blocks writes to the table while it runs
([PostgreSQL `CREATE INDEX`](https://www.postgresql.org/docs/18/sql-createindex.html)), so
whether that is acceptable depends on your write load and table size, not on size alone: a busy
installation can feel it even on a modest table. If writes must not be blocked, build the index
before deploying. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, so send it
as its own statement (for example a single `psql -c`), not inside `BEGIN … COMMIT`:

```sql
CREATE INDEX CONCURRENTLY "member_roles_roleId_memberId_idx"
  ON core.member_roles ("roleId", "memberId");
```

Then verify the result **before** deploying. The migration uses `IF NOT EXISTS`, so it keeps
any index with that name — including an invalid one left by an interrupted build, or one with a
different definition. Qualify both the index and its table, because the same name can exist in
another schema:

```sql
SELECT i.indisvalid, pg_get_indexdef(i.indexrelid)
  FROM pg_index i
 WHERE i.indexrelid = to_regclass('core."member_roles_roleId_memberId_idx"')
   AND i.indrelid = 'core.member_roles'::regclass;
```

Require **exactly one row** with `indisvalid` = `t` and the definition
`CREATE INDEX "member_roles_roleId_memberId_idx" ON core.member_roles USING btree ("roleId", "memberId")`
(no `WHERE` predicate, no expression, not `UNIQUE`). No row, an invalid index or a different
definition is not acceptable: stop the deployment, remove the index with
`DROP INDEX CONCURRENTLY IF EXISTS core."member_roles_roleId_memberId_idx"` (also its own statement),
build it again, and repeat the check. Installations that can tolerate a short write pause can
skip all of this and simply run the normal migration.

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

## Browser and headless transport

A browser consumer uses the typed same-origin routes and the public hooks of
`@/entities/organization-context`; it never talks to the API with a bearer token.

| Same-origin route (`/api/product-access/organizations/:id`) | Hook / purpose                                       |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `GET /capabilities`                                         | `useCapabilityCatalogue` — operations, presets, risk |
| `GET /role-definitions?page&search`                         | `useRoleDefinitions` — page of roles with counts     |
| `GET /role-definitions/:roleId`                             | `useRoleDefinition` — atomic snapshot of one role    |
| `POST /role-definitions` (`201`)                            | `useCreateRoleDefinition().create`                   |
| `PATCH /role-definitions/:roleId` (`200`)                   | `useRoleDefinition().save`                           |
| `POST /role-definitions/:roleId/deletion` (`200`)           | `useRoleDefinition().remove`                         |

All hooks take the same `context.controller` that `useOrganizationContext` returns, so the
list, the role page and the commands share one session and organization lifecycle. A command
returns a structured outcome:

- `committed` — the API acknowledged the exact success status; `followup` says whether the
  authority and reads were refreshed (`ready`) or could not be (`error`, `denied`, …). A failed
  follow-up never means the write was rolled back.
- `rejected` — a stable 4xx code (for example `ROLE_DEFINITION_CONFLICT`,
  `ROLE_NAME_CONFLICT`, an acknowledgment code). Nothing was written; show the code.
- `unknown` — a lost response, a deadline, a 5xx such as `ROLE_SAVE_UNAVAILABLE`, or a wrong
  success status. The write may have committed: read the role again and compare; **never
  replay it automatically**.
- `busy` — a command for the same role is already in flight; nothing is sent.
- `retired` — the session, organization or target changed under the command; its result is
  discarded.

Use the hook's **`ready`** flag, not `controller.allowed()`, to enable controls: `ready` is
reactive state, while `allowed()` is a plain call whose result a compiler-optimized production
build may cache for a stable controller. Gate writes and any presentation of a cached role on
`available` (the current read succeeded), not on `ready` alone. A committed command refreshes the
registered reads of the same controller, so the open role and the list update without extra code.

An executable example, `node scripts/fixtures/organization-roles-headless.mjs`, creates a
disposable consumer — a flat list, a create field and an inline editor that imports only the
public hooks and reaches the app through the composition layer's public server entry — and
prints three commands: install, build the shared package and run lint and type checks of the
generated code against the repository rules, and the managed real-stack browser run. The browser
run exercises list with holder counts, create (`201`), save (`200`) followed by an observable reread and a reload that
shows the persisted preset, a failed role read that hides the stale snapshot and its commands
until the next successful read, delete, the absence of any bearer credential in the browser, and
accessibility through the real BFF. The example gates cached rows, the editor and every command
on `available`, and keeps its draft keyed to the session, organization, role and snapshot
revision. No sample route is added to the starter.

## Ready role screens

Organization administrators with full team access get a fourth organization tab, **Roles**, next to
Overview, Members and Invitations. The four tabs come from one navigation widget that shows a tab only
when its destination is passed, so a downstream app can leave one out.

- `/organizations/[id]/roles` lists the roles. Built-in roles (ADMIN, MEMBER, VIEWER) are a separate
  read-only block. Custom roles are a table with name and a two-line description, rule count, holders
  and notes (**Advanced rules**, **Full control**), with name search and pages of 20. **Create role**
  asks for a name and an optional description and opens the new role.
- `/organizations/[id]/roles/[roleId]` is one role: details, **Capabilities** grouped by area with
  one checkbox per level the descriptor offers (own, assigned, all), the read-only **Advanced rules**,
  the people who hold the role, and a separate delete card. People are a sample of at most 10, the
  total, a **Show all** link to the Members tab narrowed to this role (`?role=<roleId>`, which uses
  the optional `roleId` filter of `GET /members`) and a highlighted count of pending invitations that
  use the role. Role assignment itself stays on the Members tab.
- Built-in roles and roles too large to edit open read-only; the page says why.

**Advanced rules** are stored rules the editor does not manage: field-limited reads, conditions,
explicit denies, rules on subjects outside the catalogue. A developer sets them up in code, a
migration or the legacy role-permission API. The editor shows them and leaves them unchanged on every
save; it has no builder for them.

Safe behavior built in, which a replacement screen should keep: edits stay in a draft that remembers
the revision it started from, so a change made elsewhere shows as a conflict with **Review current
version** and never overwrites; adding **Full control** and changing a role you hold need explicit
confirmation; leaving with unsaved changes asks first; deleting names the people and invitations
affected and asks for an acknowledgment only when something is affected; an unknown result is never
replayed. A background reread or an authority recheck keeps the editor and its draft in place.

**Wording for your capabilities.** Every descriptor `labelKey` needs
`organizationRoles.capabilities.<labelKey>.label` and `.description` in every catalogue, its subject
needs `organizationRoles.areas.<Subject>` and each preset `organizationRoles.levels.<preset>` and
`levelHints.<preset>`. A unit test fails when a descriptor of the shipped catalogue lacks any of them;
a downstream descriptor without wording still renders, by its id.

**Own and all.** For the Organization subject the two levels behave the same today, because every
operation is bound to the current organization. The difference becomes real for record types you add.
Role names and descriptions are what the administrator typed and are not translated.

**Linking to a role page.** Role badges (for example on the Members tab) and the role pickers of the
member and invitation dialogs link to the role page when a page provides its address once with
`RoleLinkProvider` (`@/shared/lib/role-links`); components below read it with `useRoleHref()`. Without a
provider nothing links, so every ready component also works in a headless composition and a custom
screen can supply another address or ignore the context. Picker links open a new tab so a selection in
progress is not lost.

**Routes in the app.** `app/[locale]/(organization-access)/organizations/[id]/roles/page.tsx` and
`.../roles/[roleId]/page.tsx` render `OrganizationRolesMount` and `OrganizationRoleMount` from the
composition layer's public server entry; placement provides `rolesHref(id)` and
`roleHref(id, roleId)`. To try the screens with a large organization, run
`pnpm stand preview --profile organization-roles` (see [local stands](../operations/local-stands.md)).

## Build your own editor

1. Read `GET /organizations/:orgId/capabilities` for the supported operations, presets and
   the `risk` flag, and render labels from your own translation catalogue.
2. List roles, open one, and seed your draft from `managedPresets`; show `advancedRules`
   read-only and never send them back — the server keeps them.
3. Keep the role's `aclVersion` and send the **complete** preset selection on save.
4. Require your own confirmation UI for `risk: "fullControl"` and for `selfHeld`, then send
   the acknowledgment flags.
5. Treat `ROLE_DEFINITION_CONFLICT` as "re-read and review", never replay a stale save.
