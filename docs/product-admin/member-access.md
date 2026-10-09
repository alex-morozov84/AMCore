# Member access explanation

Open **Access** on a row of the Members tab to see what one person can do in this organization and
**why**: which roles give each ability, where roles add up to more than any one of them, and which deny
rule takes something away. The server works it out from the same rules, normalization and decisions it
uses to authorize, so the explanation cannot describe a policy the API would not apply.

The view is read-only. It changes nothing and writes no audit entry.

## Who may use it

`GET /api/v1/organizations/:orgId/members/:userId/access` is bearer-only. The caller must belong to the
organization and hold full team access, like the other member routes; API keys are not accepted. The
target must be a member of the same organization (`404 MEMBER_UNAVAILABLE` otherwise).

## What it explains

The answer covers **organization membership of the current organization**. It does not simulate an API
key's scopes, a token that was already issued, another organization or any specific record. A platform
super-administrator target is reported with the qualifier `platformSuperAdmin` and is explained only
through membership: platform access is separate.

Every capability in the [capability catalogue](../auth/capability-catalogue.md) is listed, and each item
is one of three kinds. They are never mixed, and only the first makes a yes/no claim:

| `evaluation`   | Which capabilities                                                      | What it claims                                                                                                   |
| -------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `record`       | The built-in operations (organization read/update/delete, team control) | An exact decision for the current organization row (`granted`).                                                  |
| `configured`   | Every other registered capability                                       | What the role settings **configure**, by independent areas. Never a proof for one record; there is no `granted`. |
| `notEvaluated` | A capability whose adapter sets `access: 'none'`                        | Nothing. It is shown as "not evaluated", never as "not allowed".                                                 |

### Exact items (`record`)

For a built-in operation `granted` is the real decision for this organization row, for example "may change
the name". Conditions are evaluated against the row. Three layers are kept apart: the **membership
baseline** (reading the organization, independent of roles; `baseline: true`), the **exact decision**, and
the conservative **actor hint** (`allowed` / `recordRequired` / `denied`), which is display only and never
used to compare roles or name a cause.

An exact item carries `reason` (`granted`, `noGrant`, `vetoed` when it would be allowed without the deny
rules that block it, `missingPrerequisite`), `origin` (`single` when one role grants it alone, `combined`
when only the roles together do), `reachedBy`, `grantedBy`, `vetoedBy` (each a bounded role set with its
true total) and up to 10 rule `sources`.

### Configured items (`configured`)

A configured item says what the roles configure, as **areas**: `all`, `assigned`, `own` or `custom` (a
condition no preset describes). Areas are independent: a member who holds "update own" through one role and
"update assigned" through another has two areas, not a wider one. Each area lists the roles behind it and:

- `fields`: `null` when it covers every field of the item, otherwise the fields it covers;
- `prerequisite`: whether the reading the operation needs is **proven** for that area: `met` (an
  unconditional read, or a read with the identical condition, and no read deny touching the field),
  `unproven` (reading exists only for other records, or a conditional deny may touch it), `missing`,
  `blocked` (an unconditional read deny or a team veto) or `notRequired`. "Read own + update assigned" is
  `unproven`, never allowed;
- `masked`: every rule of the area is cancelled by a deny with the identical condition;
- `absorbed`: informational, because an unlimited area `all` already covers it.

The item's `state`, decided in this order, is one of:

1. `none`: no allow rule reaches the item;
2. `blocked`: an unconditional deny covers it, every area is masked, or every area's prerequisite is
   blocked (`blockedBy` names the roles);
3. `missingPrerequisite`: every unmasked area lacks the reading it needs;
4. `allowed`: an unmasked, unlimited area `all` with a met prerequisite and no limit applying to it;
5. `configured`: everything else (a conditional area, a limit, an unproven prerequisite).

`allowed` means **permitted by the member's stored policy for any record at that level**. It is not a
guarantee about any handler, which can add tenant, status, ownership and credential checks.

`limits` name why a configured right is narrower than it looks, each from its own cause: `fields` (an allow
covers only some fields), `condition` (a custom condition), `denyCondition` (a conditional deny that may
exclude some records; the condition is never solved, only compared textually) and `denyFields` (an
unconditional deny blocks some fields). Per-field lines (`<capability>.<field>`) are returned only when they
differ from their operation.

Rule `sources` (at most 4 per configured item) are chosen **after** every rule was used for the decision.
Allow sources name their area and their own prerequisite; deny sources are `vetoes` (they block or mask),
`restricts` (they may exclude records) or, for a masked allow, `overridden`.

### The response

| Field             | Meaning                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `member`          | `memberId`, `userId`, `name`, `email`                                                                   |
| `aclVersion`      | Organization revision the answer was read at                                                            |
| `scope`           | Always `organization-membership`                                                                        |
| `roles`           | Roles that count: `total`, up to 50 `items` (`id`, `name`, `isSystem`) and `truncated`                  |
| `unsafeLinkCount` | Persisted links to roles outside this organization. They are ignored, as authorization ignores them     |
| `items[]`         | The three kinds above                                                                                   |
| `widening`        | `scope: 'exactItems'`, `excludedItems`, `status`, and `breadth`, `synergy`, `vetoed` (`null` = unknown) |
| `uncovered`       | Number of stored rules no evaluated capability explains, with up to 10 roles that hold them             |
| `qualifiers`      | `platformSuperAdmin` when the target is a platform administrator                                        |

`widening` compares roles and answers "who alone would grant" only for **exact items**; `excludedItems` says
how many items it did not consider, so no claim is made about configured ones. Configured items name the
roles that hold each rule, not who would "alone" grant them.
Configured rule sources include up to five `roleIds` and their true `total`. When rules or role
references are omitted, `sourcesTruncated` is `true`; the dialog tells the reader the list is incomplete.

## Limits and errors

The server loads the member's whole policy in one repeatable-read snapshot and refuses to answer from part
of it. Everything below is `503 ROLE_ACCESS_UNAVAILABLE`:

| Limit                                        | Value                                 |
| -------------------------------------------- | ------------------------------------- |
| Roles, role-permission links, distinct rules | 1000 / 5000 / 2000                    |
| Serialized stored rules                      | 1 MiB                                 |
| A stored rule that is not valid              | none (the whole request fails)        |
| Items the catalogue can produce              | 600 (operations plus editable fields) |
| Editable fields of one capability            | 32                                    |
| Internal checks one request may spend        | 3,000,000                             |
| Response size                                | 523,264 bytes (524,288 at the BFF)    |

The catalogue size is known without the database, so a catalogue over 600 items is refused **before
anything is loaded**. The reason is logged once and never returned. Above **25 roles or 500 distinct rules**
the single-role questions of the exact items are skipped: `origin`, `reachedBy`, `grantedBy`, `vetoedBy` and
the three `widening` flags become `null`, a denied exact item has `reason: null`, and `widening.status` is
`unavailable`. Configured items do not use those questions and are unaffected.

Rules on a subject or action no evaluated capability explains (a member's own profile in the `MEMBER` role,
an allow on every subject, an unknown domain, a rule whose fields no capability knows, any rule of a capability
that opted out, denies included) are counted in `uncovered`, not explained.

## Browser and headless use

The ready screens call `GET /api/product-access/organizations/:id/members/:userId/access` and
`useMemberAccess(controller, userId)` from the public entity API; the response is wrapped like the other
organization reads (`{binding, data}`, `private, no-store`). A custom screen can use the same hook and
render the response however it likes.

The ready dialog keeps its header and footer in place while the body scrolls. It lists what the person can
do, what is configured for some records and what is blocked, grouped by area; what no role gives is
collapsed under "Not allowed", and "Not evaluated" is its own group. A configured row shows each area with
its roles, the limits by cause and, when it cannot prove the reading it needs, says so. A note states that
configured access is not a check of a specific record. "Why" names the roles that allow, restrict and block
an item (a ban always beats an allow). A long list (more than 12 shown items) gains a search and collapsible
areas; a short one keeps the flat layout. Rules outside the catalogue are one collapsed note, **Other
permissions in roles**. It shows a loading state and hides the answer when a read fails or the viewer
loses authorization. A background reread keeps the answer while the viewer remains authorized.

## Capabilities your product adds

Register a capability once (catalogue entry, adapter, label keys; see the
[extension steps](../auth/capability-catalogue.md#extend-a-downstream-product)) and both screens list it
with no further UI code. The explanation reads everything it needs from the adapter you already write:
`subject`, `action`, `editableFields`, `presets` and their `preset()` template, `requiredReadFields` and
`teamAccess`.

- It is a **configured** item, answered by areas as above. You do not extend `record()` or `actor()` for the
  explanation; those stay your own context contracts.
- Declare `access: 'none'` on the adapter to opt out. The capability is then **not evaluated** (and its rules
  count as other permissions), never "not allowed".
- Every catalogue label key, area and level needs copy in every web catalogue; a parity test fails when it is
  missing.
- Checking one concrete record (can this member edit product 123?) is a different question and is not
  answered here.
