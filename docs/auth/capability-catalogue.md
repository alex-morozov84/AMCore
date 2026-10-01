# Capability catalogue and access hints

The catalogue describes operations the starter actually implements. It is
code-declared metadata for a future role editor, not a role grant or a route
authorization decision. Current entries cover full team-access management and
organization read, update and delete. A product adds its own resources through
the shared/API extension points below.

## Three different answers

| Answer                                | API surface                                                                            | Meaning                                                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What can this product author?         | Bearer-only `GET /organizations/:orgId/capabilities`, full TeamAccess required         | Stable operation IDs, supported presets, fields and credential eligibility. No current employee permissions or raw conditions.                                                                                                 |
| What might I do in this organization? | Bearer-only `GET /organizations/:id/context` → `actorAffordances`                      | Effective current employee and verified organization. `allowed` requires unconditional prerequisites; `recordRequired` means an actual trusted record is needed, with no promise that one exists; `denied` has no viable path. |
| What can I do with this record?       | The same context response → `recordAffordances` for its server-loaded organization row | Read, update and delete decisions with relevant fields for this actual record. A later write checks authority again. Downstream domain lists attach equivalent hints to rows they already fetched.                             |

The selected-context response keeps `canManageTeamAccess` for existing callers;
its value equals the named `teamAccess.manage` actor decision. The two-card
organization overview uses only this verified team decision. It has no role,
member, invitation or permission editing page.

The catalogue and preset routes are backend API contracts. The current web BFF
does not expose an editor transport for them; a downstream editor must add an
explicit typed same-origin operation with the normal session and Origin checks.

## Author a permission

`POST /organizations/:orgId/roles/:roleId/permissions/presets` accepts exactly
`{ "capabilityId": "organization.update", "presetId": "own" }` for a
registered pair. It is bearer-only, requires verified matching organization
context, full TeamAccess and a custom role in that organization. The server
stores `${user.organizationId}` or `${user.sub}` **as a template for the future
permission holder**. It interpolates only when that holder's ability is built;
the author never becomes the rule's owner or assignee. A new catalogue entry
does not grant an existing role anything.

The older `POST /organizations/:orgId/roles/:roleId/permissions` still accepts
valid advanced allow and DENY rules for known model subjects even when the
subject/action is absent from the UI catalogue. New writes are checked before
the Permission row, role link or ACL version changes. Unknown model fields,
unsupported operators and principal placeholders receive distinct 400 codes:
`PERMISSION_RULE_UNSUPPORTED`, `PERMISSION_FIELD_UNSUPPORTED` and
`PERMISSION_PLACEHOLDER_UNSUPPORTED`. The preset route additionally returns
`CAPABILITY_UNSUPPORTED` for an unknown capability/preset pair. Existing valid
stored rules keep their IDs and meaning; a future editor must display custom
rules read-only rather than silently replacing them. An incompatible historical
rule fails ability construction closed and needs privileged audit and controlled
repair. Do not repair by deleting or ignoring a DENY during a request.

Condition paths are known public scalar fields of User, Organization, Role and
Permission. Direct typed equality, `not`, `in`, `notIn`, numeric/date
`gt/gte/lt/lte`, string `contains/startsWith/endsWith` and bounded nonempty
`AND/OR/NOT` are supported. Relation, JSON/list and unknown fields/operators
are rejected. The only template paths admitted for new rules are whole values
`${user.sub}` and `${user.organizationId}` on compatible String fields. Stored
DateTime comparisons use **integer epoch milliseconds** within JavaScript
`Date`'s range; evaluation converts a fresh copy to `Date` before CASL and
Prisma parsing. ISO strings and fractional dates are rejected because their
record and SQL behavior would differ. These limits are checked separately
from the route's tenant, immutable-field and response-field policy.

| Subject        | Accepted condition and field names                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `User`         | `id`, `email`, `emailVerified`, `name`, `avatarUrl`, `phone`, `locale`, `timezone`, `createdAt`, `updatedAt`, `lastLoginAt`, `systemRole` |
| `Organization` | `id`, `name`, `slug`, `aclVersion`, `createdAt`, `updatedAt`                                                                              |
| `Role`         | `id`, `name`, `description`, `isSystem`, `organizationId`                                                                                 |
| `Permission`   | `id`, `action`, `subject`, `inverted`, `organizationId`                                                                                   |

For these four subjects, `fields` may also be omitted, `[]` or `['*']` for all
fields. `TeamAccess` supports only `manage` with no condition and unrestricted
fields. Subject `all` supports DENY only; any condition or field restriction
must be valid for every model subject. Logical nesting is limited to four
levels and 64 condition nodes; `in` and `notIn` accept at most 64 values. An
empty nested branch, unknown field, relation path or unsupported operator is
rejected before a permission is saved.

## Extend a downstream product

1. Add the domain Prisma model and a migration. Add its name to the shared
   `Subject` enum and model-permission schema. This also makes syntactically
   valid `action:NewSubject` API-key scopes issuable by the current low-level
   API, even before a route uses them; review credential policy before issuance.
2. Add a typed operation descriptor to `CAPABILITY_CATALOGUE` and the shared
   capability ID/response schemas. Name the exact handler, action, subject,
   supported presets and editable fields. Register its model scalar grammar in
   `permission-model-fields.ts` and its typed subject in `AppAbility`.
3. Implement admission, credential, tenant, field and record checks in the
   domain handler and service. Register the matching operation metadata and
   preset builder in `CapabilityRegistry`; its startup check compares the
   declared catalogue entries with the registered adapter entries. Add the
   handler to `capability-policy-parity.spec.ts` and verify its route, auth and
   guards against the descriptor before publishing it. Credential metadata
   never overrides route `@Auth` or the API-key allowlist.
4. For lists, combine `accessibleBy(ability)` with the verified tenant predicate
   using `AND`. Load the page once, check actual rows/fields in memory, and
   project bounded action hints. Compute the visible total after field filtering
   (or enforce the same filter in SQL); never disclose a hidden-row count.
   Check write input, pre-state and post-state in the transaction; keep tenant
   and assignment columns immutable. An action
   hint is never the write authorization. Do not send client-provided records
   to a generic `/can` endpoint or call the server once per button.
5. Compile shared, API and web consumers; exercise multiple roles, conditional
   own/assigned/all, DENY, wrong tenant, fields and API-key intersection on
   PostgreSQL. Run `pnpm test:capability-extension` from the repository root:
   it applies a disposable `FixtureOrder` source/migration/controller variant
   in an isolated temporary copy, compiles all three consumers and runs its
   Testcontainers e2e. The command needs installed dependencies and local Docker.
   No fixture model or route ships in the starter. Document the domain's actual
   screens separately.

An issued `read:all` key does **not** acquire access merely because a subject
appears in the catalogue. If the owner later receives a read grant for a new
subject, however, the old key may become effective on a route that separately
accepts API keys. The same future activation applies to a dormant
`manage:NewSubject` scope. Freezing wildcard meaning would need a separate
versioned credential mechanism.
