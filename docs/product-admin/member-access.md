# Member access explanation

Open **Access** on a row of the Members tab to see what one person can do in this organization and
**why**: which roles give each ability, where roles add up to more than any one of them, and which
deny rule takes something away. The server works it out from the same rules, normalization and
decisions it uses to authorize, so the explanation cannot describe a policy the API would not apply.

The view is read-only. It changes nothing and writes no audit entry.

## Who may use it

`GET /api/v1/organizations/:orgId/members/:userId/access` is bearer-only. The caller must belong to
the organization and hold full team access, like the other member routes; API keys are not accepted.
The target must be a member of the same organization (`404 MEMBER_UNAVAILABLE` otherwise).

## What it explains

The answer covers **organization membership of the current organization**. It does not simulate an
API key's scopes, a token that was already issued, another organization or records that do not exist
yet. A platform super-administrator target is reported with the qualifier `platformSuperAdmin` and is
explained only through membership: platform access is separate.

Three layers are kept apart in the response:

1. **Membership baseline.** Facts that do not depend on any role. Today this is reading the
   organization. A baseline item has `baseline: true`, one `{ "kind": "membership" }` source and no
   role facets, and it never counts toward widening.
2. **Exact decisions for the current organization.** For every other item `granted` is the real
   decision for this organization row, for example "may change the name". Conditions are evaluated
   against the row, so a rule for another organization id is not a reason.
3. **Actor hint.** The conservative `allowed` / `recordRequired` / `denied` that the capability
   catalogue already publishes for an operation. It is shown for context and is never used to compare
   roles, name a cause or decide widening.

## Response

| Field             | Meaning                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `member`          | `memberId`, `userId`, `name`, `email`                                                               |
| `aclVersion`      | Organization revision the answer was read at                                                        |
| `scope`           | Always `organization-membership`                                                                    |
| `roles`           | Roles that count: `total`, up to 50 `items` (`id`, `name`, `isSystem`) and `truncated`              |
| `unsafeLinkCount` | Persisted links to roles outside this organization. They are ignored, as authorization ignores them |
| `items[]`         | One entry per catalogue capability, plus one per field it can edit (`organization.update.name`)     |
| `widening`        | `status`, and `breadth`, `synergy`, `vetoed` (`null` means unknown, never "false")                  |
| `uncovered`       | Number of stored rules this summary does not explain, with up to 10 roles that hold them            |
| `qualifiers`      | `platformSuperAdmin` when the target is a platform administrator                                    |

An item carries:

- `granted` and `reason`: `granted`, `noGrant` (no role allows it), `vetoed` (it would be allowed without the rules that block it, whether one role allows it alone or several roles do together; and
  another role blocks it) or `missingPrerequisite` (a role allows it but something it depends on is
  missing, for example deleting also needs team control).
- `origin` for a granted item: `single` when at least one role would grant it alone, `combined` when
  it is granted only by the roles together. `reachedBy` lists the roles that grant it alone.
- `grantedBy` and `vetoedBy` for a denied item: the roles that would grant it alone, and the roles that
  block it. Each is a bounded set (`roleIds` up to 5 and the true `total`).
- `sources`: up to 10 rules behind the decision (`sourcesTruncated` says if there are more), each with
  the roles that hold it, its `effect` (`allow` or `deny`) and `status` (`contributes`, `vetoes` or
  `overridden`). A source follows the same dependencies as the decision: `direct` (the item's own
  rule), `readPrerequisite` (updating needs every organization field readable), `deletePrerequisite`
  (deleting needs delete on each field), `teamAccessGate` (the allow rule for team control) and
  `teamAccessVeto` (a deny rule on team access, roles, permissions or users, which blocks team control
  whatever its action, fields or conditions). A source describes how a rule applies to the current
  record; it is never "the final winner".

`widening.breadth` is true when the roles together allow strictly more than every single role does.
`synergy` is true when some ability exists only because of the combination. `vetoed` is true when some
ability is blocked although a role would allow it.

## Limits and errors

The server loads the member's whole policy in one repeatable-read snapshot and refuses to answer
from part of it:

| Limit                                        | Value                              | When exceeded                 |
| -------------------------------------------- | ---------------------------------- | ----------------------------- |
| Roles, role-permission links, distinct rules | 1000 / 5000 / 2000                 | `503 ROLE_ACCESS_UNAVAILABLE` |
| Serialized stored rules                      | 1 MiB                              | `503 ROLE_ACCESS_UNAVAILABLE` |
| A stored rule that is not valid              | none                               | `503 ROLE_ACCESS_UNAVAILABLE` |
| Response size                                | 523,264 bytes (524,288 at the BFF) | `503 ROLE_ACCESS_UNAVAILABLE` |

Above **25 roles or 500 distinct rules** the per-role questions (who alone would grant, who widens) are
skipped: decisions, hints and sources stay exact, but `origin`, `reachedBy`, `grantedBy`, `vetoedBy`
and the three `widening` flags become `null`, a denied item has `reason: null`, and
`widening.status` is `unavailable` with `reason` `roleLimit` or `ruleLimit`.

A policy that the editor would call oversized (more than 200 rules in one role) is still explained
exactly while it stays within these limits. Rules that are not about the organization or team access
(for example reading one's own profile) are counted in `uncovered`, not explained.

## Browser and headless use

The ready screens call `GET /api/product-access/organizations/:id/members/:userId/access` and
`useMemberAccess(controller, userId)` from the public entity API; the response is wrapped like the other
organization reads (`{binding, data}`, `private, no-store`). A custom screen can use the same hook and
render the response however it likes. The ready dialog shows a loading state, hides the answer when a
read fails (never stale facts) and keeps what it shows during a background reread.

## Your own capabilities

An item appears for every capability in the catalogue. The decision comes from the capability's
`record` entry in the registry, and the hint from its `actor` entry, so a downstream capability that
publishes those gets decisions and per-role attribution without more code. Rule-level `sources` are
produced for the built-in organization and team-access capabilities; a downstream capability shows its
decision and the roles that grant or block it, without the rule list. Wording for a capability comes
from the same `organizationRoles.capabilities.<labelKey>` keys the role editor uses.
