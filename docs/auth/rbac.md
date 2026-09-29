# RBAC — Roles, Permissions & Organizations

The single guide to authorization in AMCore: how the system decides what an
authenticated caller is allowed to do, and how to extend it for your own domain.
Authentication (proving _who_ you are) is covered in
[Concepts](./concepts.md); this doc is about _what you can do_ once authenticated.

Endpoint shapes (paths, request/response bodies, status codes) live in the
Swagger/OpenAPI document at `/docs` in development — the source of truth. This
guide covers the model and the invariants OpenAPI does not express.

---

## The two layers

Every request is evaluated against two independent layers. **Both must pass**,
with an internal `SUPER_ADMIN` owner grant. API-key scopes still narrow that grant;
organization management still requires matching organization context.

```
Request
  │
  ▼
Layer 1 — System role      USER        → normal access, continue to layer 2
                           SUPER_ADMIN → synthesized owner grant, then credential scopes
  │
  ▼
Layer 2 — Org permissions  org membership + roles + permissions, evaluated by CASL
```

|                  | System role                      | Org permission                       |
| ---------------- | -------------------------------- | ------------------------------------ |
| **Scope**        | Platform-wide                    | Within one organization              |
| **Stored**       | User record + JWT claim          | Database + Redis cache               |
| **Granularity**  | Coarse (2 levels)                | Fine (action + subject + conditions) |
| **Changed by**   | `SUPER_ADMIN`                    | Explicit full `TeamAccess` holder    |
| **Takes effect** | Next login (see freshness below) | Next request                         |

---

## Layer 1 — System roles

A **system role** is a server-wide access level stored on the user record and
mirrored into the JWT.

| Role          | Assigned to         | What it grants                                           |
| ------------- | ------------------- | -------------------------------------------------------- |
| `USER`        | Everyone by default | Normal platform access; still subject to org permissions |
| `SUPER_ADMIN` | Platform owner(s)   | Full access to everything, including the admin panel     |

`SUPER_ADMIN` is granted manually — there is no self-promotion endpoint. In a
controller, gate a route with `@SystemRoles`:

```typescript
@SystemRoles(SystemRole.SuperAdmin)
@Get('/admin/users')
getAllUsers() { ... }
```

### System-role freshness (next request)

The common authentication guard checks every JWT `SUPER_ADMIN` claim against
primary Postgres **before** building CASL permissions, including routes without
`@SystemRoles`. A single request-local admission result keeps original credential
facts separate from the effective principal passed to CASL, TeamAccess, tenant
row-lock checks and AI control authorization. A demoted claim becomes effective
`USER`; it cannot retain a platform permission or membership bypass through the
user cache. Ordinary unannotated `USER` JWTs need no extra privileged-role read.

`@SystemRoles` still requires both the **original claim** and **current DB role**
to belong to its required set. Projecting a demoted claim to `USER` does not make
it an original `USER` credential for a USER-only requirement. The role guard reuses
admission evidence, without a second primary lookup. Missing users and primary
lookup failures fail closed; infrastructure errors remain observable.

- **Demotion takes effect on the next request**, including ordinary organization
  routes and AI platform bypasses, without relying on cache invalidation/session cleanup.
- **Promotion cannot elevate an old USER claim.** Obtain a new credential through
  the normal authenticated issuance flow.
- Administrative system-role changes still revoke the affected user's sessions;
  [session revocation](./sessions.md) and live-role admission are separate protections.
- API-key authentication already reads the owner's current role from primary;
  admission reuses it, retaining live membership and scope intersection.

This mirrors the org-permission freshness contract below.

### Operations Console access probe

`GET /api/v1/admin/access` is the purpose-specific, bearer-only policy probe for
the Operations Console. It returns `204 No Content` only when the JWT
claim and current database role are both `SUPER_ADMIN`; it deliberately returns
no profile, role, permission, or admin data. Missing or API-key credentials are
rejected with `401`; a `USER`, organization owner, or organization-role holder
receives `403`. As with every `@SystemRoles` route, a demotion denies the next
request even if its existing JWT has not expired.

### Administering `SUPER_ADMIN`

Promote (or demote) an existing user through the admin API (requires a
current `SUPER_ADMIN` session):

```http
PATCH /api/v1/admin/users/:userId
{ "systemRole": "SUPER_ADMIN" }
```

The Operations Console's Users panel is an authenticated management surface
for this same endpoint, not a separate contract — see [its user
guide](../operations-console/users.md#change-a-users-system-role)
for the confirmation/step-up/session-revocation behavior a browser operator
sees. Both the API and the Console enforce the same self-change and
last-`SUPER_ADMIN` guards described above.

**Bootstrapping the first admin** has no API path — set it directly in the
database:

```sql
UPDATE core.users
SET "systemRole" = 'SUPER_ADMIN'
WHERE email = 'admin@yourdomain.com';
```

`SUPER_ADMIN` also unlocks the Bull Board queue dashboard at `/admin/queues`.
**Bull Board is disabled in production unless `ENABLE_BULL_BOARD=true`, is never
mounted on the `worker` role, requires a `SUPER_ADMIN` session cookie, and
defaults to read-only (`BULL_BOARD_READ_ONLY=true`).** Set it writable only when
operators need to retry/promote/clean jobs. Because it is cookie-backed, it is
in scope for the CSRF policy — see [CSRF Posture](./csrf.md).

---

## Layer 2 — Organizations, roles & permissions

An **organization** is a shared workspace. It is optional — a `USER` can work
solo. Without an org context, a caller can only read and update their own
profile. Create an org when several people need to collaborate with different
levels of access. A user can belong to multiple orgs, each with its own roles.

### Selecting organization context

Covered organization handlers accept a personal JWT and verify their explicitly
selected organization before building rights. Path IDs are authoritative;
an optional `X-AMCore-Organization-ID` must match. See the
[context contract and extension recipe](./organization-context.md).
The existing org-switch endpoint (`POST /organizations/:orgId/switch`) remains
available for clients that use organization-bound JWTs. Its response supplies
an organization-bound access token:

```json
{
  "sub": "cm1abc...",
  "systemRole": "USER",
  "organizationId": "org_xyz...",
  "aclVersion": 5
}
```

Organization exchange preserves the parent's absolute `exp`: repeated `/switch`
calls never renew access. A parent without a valid future expiry returns `401`.
A-to-B exchange remains supported when the actor currently belongs to B; the
response remains `{accessToken}`. Use ordinary refresh or login to renew access.
The signed `sid` is preserved for existing step-up checks, not live-session proof.
Revoking a session does not instantly expire an already issued JWT; derived tokens
cannot extend that residual window beyond their parent. Login, refresh and step-up
retain their ordinary issuance rules.

The org creator automatically becomes its `ADMIN`.

### Built-in org roles

A role is a named bundle of permissions. Three shared system roles are seeded
and available to every organization; they cannot be deleted:

| Role     | Explicit default permissions                                                                     |
| -------- | ------------------------------------------------------------------------------------------------ |
| `VIEWER` | Read the current Organization's six response fields; read own safe User profile fields           |
| `MEMBER` | VIEWER + update own profile's editable fields                                                    |
| `ADMIN`  | MEMBER + update current Organization name/slug, delete current Organization, manage `TeamAccess` |

Organization fields are `id`, `name`, `slug`, `aclVersion`, `createdAt`, `updatedAt`.
Safe profile reads match `userResponseSchema`; editable profile fields match
`updateProfileSchema`. The definitions live in
`apps/api/src/core/auth/casl/org-role-defaults.ts`; production seed and test fixtures
share six permissions and eleven role links. New resources and fields receive no
automatic grants, including for ADMIN. Domain rights must be deliberately assigned.
VIEWER does not disable independent account self-service handlers.

Role labels confer no authority. Multiple positive roles widen explicitly granted
access; any matching DENY overrides their allows. The API cannot modify/delete
built-in templates. Seed only initializes a clean database or verifies exact current
templates; an installed legacy database needs the [controlled upgrade](authorization-upgrade.md).

### Full team administration

`manage:TeamAccess` is a separate, unrestricted full policy authority, not a Prisma
model. It permits same-org role/permission editing, role assignment and invite/member
management. A trusted administrator can deliberately grant any supported role or
permission, including TeamAccess. Limited delegation is not supported.

An ordinary caller needs live membership, explicit matching org context, an exact
unrestricted owner `manage:TeamAccess` rule, and no owner DENY on TeamAccess, Role,
Permission, User or `all`. Any such DENY vetoes full team trust even if conditional
or field-limited; Organization DENYs instead govern org data operations independently.
Role names, `manage:Organization`, and model-management grants cannot substitute.
API keys additionally need the exact `manage:TeamAccess` scope. Owner trust is checked
before scopes, so narrower scopes cannot hide a restrictive owner rule.

```typescript
@RequireTeamAccess('orgId')
@Post('roles')
createRole() { /* existing same-org service checks still apply */ }
```

PATCH organization data requires update on the actual record and every supplied
name/slug field, plus read on all response fields. Inside one row-locked transaction,
these checks are repeated on the actual Prisma update result, including `updatedAt`;
any failed post-state/read check throws and rolls back the entire write. Empty PATCH
performs authorization without UPDATE and preserves its timestamp. Timestamps,
IDs and ACL versions are server-owned. DELETE cascades team data: it requires both
TeamAccess and delete on every Organization scalar. Full team authority alone does
not grant org deletion. Existing last-system-ADMIN checks remain a separate invariant.

### Permission shape

Roles grant nothing by themselves — permissions do. A permission is:

```
Permission {
  action:     "create" | "read" | "update" | "delete" | "manage"
  subject:    "User" | "Organization" | "Role" | "Permission" | "TeamAccess" | "all"
  conditions: { "assignedToId": "${user.sub}" }   ← optional, row-level scope
  fields:     ["name", "email"]                    ← optional, field-level scope
  inverted:   false                                ← true = explicit DENY
}
```

- **action** — `manage` is the wildcard for all four concrete actions.
- **subject** — the resource type. `all` is the wildcard for every subject;
  positive `all` grants are rejected for stored org policies. Wildcard DENYs remain
  supported; the factory alone synthesizes a positive `manage:all` for SUPER_ADMIN.

`action` and `subject` are **closed enums** (`Action` and `Subject` in
`packages/shared/src/enums/permissions.ts`). `assignPermissionSchema` validates
subject-specific branches, so an off-enum value returns `400 Bad Request`. Domain subjects
(`Contact`, `Deal`, …) are **not** built in — a fork adds them (see
[Adding your own subjects](#adding-your-own-subjects)).

TeamAccess assignments accept only `manage`, absent/null/empty conditions and
absent/empty/`["*"]` fields, with an optional DENY flag. `all` assignments must be
DENYs. Partial TeamAccess and positive wildcard grants return 400 validation errors.

### Conditions

Conditions restrict a rule to matching rows. They use `${...}` placeholders
resolved from the request principal at evaluation time:

```json
{ "assignedToId": "${user.sub}" }
{ "organizationId": "${user.organizationId}" }
{ "status": "active" }
```

Supported paths are dotted lookups on the principal — `${user.sub}` (the current
user's ID) and `${user.organizationId}` are the common ones. This expresses
rules like "update Contacts, but only ones assigned to you" with no imperative
`if` in your service — CASL applies the filter.

---

## Record, field and query enforcement

Stored conditions contain JSON values. The native matcher compares DateTime facts
against numeric epoch milliseconds (covered by organization PATCH tests); this
contract does not promise ISO-string equality or arbitrary DateTime SQL parity.
The bounded Prisma recipe below uses Role scalars and has no DateTime fields.

The factory validates and interpolates the entire owner payload before scope
narrowing, eagerly parses conditions, deduplicates source variants and orders
allows before DENYs deterministically. Invalid stored rules fail the whole request
with 500, including rules outside a key's scopes. Request validation failures are
400; ordinary authorization failures are 403 `FORBIDDEN`; infrastructure failures
propagate. No failed rule is silently dropped.

A method-level `ability.can(action, Subject)` is only a coarse admission check.
Load the full actual record, check each input/output field, and keep authorization
and writes together. Never fake a partial record that omits policy facts. A field-less
delete check ignores field restrictions; whole-row deletion must require every scalar.

### Adding your own subjects

Add the generated domain model to AppSubjects in the ability factory, register its
Subject enum value and explicit model-permission schema branch, then rebuild shared.
Add actual controller/service policies and OpenAPI metadata. Scopes recognize registered
subjects automatically, but defaults grant nothing to the new subject. Explicitly
assign appropriate domain permissions through a trusted TeamAccess holder.
Creation additionally needs checks on server-owned tenant/owner facts; read filters
do not authorize creation. Review immutable fields and every new model scalar.

### Executable Prisma recipe

The following bounded Role fixture is compiled and exercised against PostgreSQL;
its source is `apps/api/test/recipes/role-authorization.recipe.ts`. It demonstrates
how a domain consumer reuses the injected PrismaService and pool. Actual Role routes
continue to require TeamAccess; this fixture adds no demo endpoint. Adapt imports
for the destination module and use the request's factory-built ability.

The wrapper `core/auth/casl/prisma-ability.ts` uses generated Prisma.TypeMap and
`@casl/prisma/runtime`, avoiding the unconfigured generated-package client surface.
The derived client is extended once before transactions; it is not a global service
replacement and must not be disconnected separately.

Adapter 2.0.2 `accessibleBy` emits literal `{OR: []}` on no access. Its extension
rewrites nested empty OR before making a DB call; it does not promise a pre-query
short circuit. Both tenant AND orders are tested. SQL row selection does not redact
fields: list/direct read project each actual record, and unreadable IDs hide rows.
Count measures row authority and can include records whose field projection is unusable.

The fixture supports Role scalar equality/membership/not/comparison and AND/nonempty
OR/NOT. Relation filters, arbitrary nested empty OR, JSON/list policy DSLs, create and
aggregate operations are excluded. Unsupported shapes fail closed. Updates accept
name/description only; mixed allowed/forbidden input rejects the whole patch, and
pre/post state is checked under the lock. Whole-row DELETE checks all five current
Role scalars: name-only allow or a name-field DENY must leave the row unchanged;
unrestricted authorized deletion succeeds. Scalar coverage is checked against the
generated model enum.

<!-- role-authorization-recipe:start -->

```typescript
import { subject } from '@casl/ability'

import { ForbiddenException } from '../../src/common/exceptions'
import type { AppAbility } from '../../src/core/auth/casl/ability.factory'
import { accessibleBy, createCaslExtension } from '../../src/core/auth/casl/prisma-ability'
import type { Prisma, Role } from '../../src/generated/prisma/client'
import type { PrismaService } from '../../src/prisma'

export const ROLE_SCALAR_FIELDS = [
  'id',
  'name',
  'description',
  'isSystem',
  'organizationId',
] as const
const operators = new Set(['equals', 'in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte'])

function validateCondition(value: unknown, fieldValue = false): void {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Unsupported recipe condition')
  for (const [key, item] of Object.entries(value)) {
    if (!fieldValue && ['AND', 'OR', 'NOT'].includes(key)) {
      const items = Array.isArray(item) ? item : [item]
      if (!items.length) throw new Error('Empty logical recipe condition')
      items.forEach((part) => validateCondition(part))
    } else if (
      !fieldValue &&
      ROLE_SCALAR_FIELDS.includes(key as (typeof ROLE_SCALAR_FIELDS)[number])
    ) {
      validateCondition(item, true)
    } else if (fieldValue && operators.has(key)) {
      if (key === 'in' || key === 'notIn') {
        if (!Array.isArray(item)) throw new Error('Invalid scalar membership')
        item.forEach((part) => validateCondition(part, true))
      } else validateCondition(item, true)
    } else throw new Error('Unsupported recipe operator or scalar')
  }
}

function assertAction(
  ability: AppAbility,
  action: string,
  row: Role,
  fields: readonly string[]
): void {
  const record = subject('Role', row)
  if (!ability.can(action, record) || fields.some((field) => !ability.can(action, record, field))) {
    throw new ForbiddenException('Role record or field permission denied')
  }
}

function project(ability: AppAbility, row: Role): Partial<Role> | null {
  const record = subject('Role', row)
  if (!ability.can('read', record) || !ability.can('read', record, 'id')) return null
  return Object.fromEntries(
    ROLE_SCALAR_FIELDS.filter((field) => ability.can('read', record, field)).map((field) => [
      field,
      row[field],
    ])
  )
}

/** Test/docs fixture only: uses the injected pool; actual team routes require TeamAccess. */
export function roleAuthorizationRecipe(
  prisma: PrismaService,
  ability: AppAbility,
  organizationId: string
): {
  list: () => Promise<Partial<Role>[]>
  count: () => Promise<number>
  read: (id: string) => Promise<Partial<Role>>
  update: (id: string, patch: Record<string, unknown>) => Promise<void>
  remove: (id: string) => Promise<void>
} {
  for (const rule of ability.rules) {
    const subjects = Array.isArray(rule.subject) ? rule.subject : [rule.subject]
    if (rule.conditions && subjects.some((name) => name === 'Role' || name === 'all'))
      validateCondition(rule.conditions)
  }
  const client = prisma.$extends(createCaslExtension())
  const where = (action: string): Prisma.RoleWhereInput => ({
    AND: [accessibleBy(ability, action).ofType('Role'), { organizationId }],
  })
  const lock = async (tx: Pick<typeof client, '$queryRaw' | 'role'>, id: string): Promise<Role> => {
    await tx.$queryRaw`SELECT id FROM core.roles WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`
    const row = await tx.role.findFirst({ where: { id, organizationId } })
    if (!row) throw new ForbiddenException('Role outside authorized tenant')
    return row
  }
  return {
    list: async (): Promise<Partial<Role>[]> => {
      const rows = await client.role.findMany({ where: where('read'), orderBy: { id: 'asc' } })
      return rows.map((row) => project(ability, row)).filter((row) => row !== null)
    },
    count: async (): Promise<number> => client.role.count({ where: where('read') }),
    read: async (id: string): Promise<Partial<Role>> => {
      const row = await client.role.findFirst({ where: { AND: [where('read'), { id }] } })
      const result = row ? project(ability, row) : null
      if (!result) throw new ForbiddenException('Role read denied')
      return result
    },
    update: async (id: string, patch: Record<string, unknown>): Promise<void> => {
      const fields = Object.keys(patch)
      if (
        fields.some((field) => !['name', 'description'].includes(field)) ||
        (patch.name !== undefined && typeof patch.name !== 'string') ||
        (patch.description !== undefined &&
          patch.description !== null &&
          typeof patch.description !== 'string')
      ) {
        throw new ForbiddenException('Immutable or invalid Role field')
      }
      await client.$transaction(async (tx) => {
        const row = await lock(tx, id)
        assertAction(ability, 'update', row, fields)
        // Role has no automatic timestamps or generated mutable scalars.
        assertAction(ability, 'update', { ...row, ...patch } as Role, fields)
        const changed = await tx.role.updateMany({
          where: { AND: [where('update'), { id }] },
          data: patch as Prisma.RoleUpdateManyMutationInput,
        })
        if (changed.count !== 1) throw new ForbiddenException('Role update predicate denied')
      })
    },
    remove: async (id: string): Promise<void> => {
      await client.$transaction(async (tx) => {
        const row = await lock(tx, id)
        assertAction(ability, 'delete', row, ROLE_SCALAR_FIELDS)
        const deleted = await tx.role.deleteMany({ where: { AND: [where('delete'), { id }] } })
        if (deleted.count !== 1) throw new ForbiddenException('Role delete predicate denied')
      })
    },
  }
}
```

<!-- role-authorization-recipe:end -->

## Freshness & caching

JWT authorization that uses organization permissions reads the current
organization `aclVersion` from the **primary database**, even when the permission
payload is cached. Scoped context admission obtains membership and version
together; ability and TeamAccess reuse that snapshot. Other legacy callers retain
their version-read path. API keys reuse their live membership admission snapshot.
Personal ability and explicit existing live `SUPER_ADMIN` bypasses remain; the
new selected overview requires membership even for a platform administrator.

```
Permissions cache key: auth:perm:v2:{orgId}:{userId}:{aclVersion}
Permissions TTL:       1 hour
```

An ACL mutation and its organization's version increment must commit in the
**same database transaction**. The first authorization lookup that starts after
that commit selects the new version, so the same JWT immediately observes role
or permission removal; no sign-out or token refresh is required. A request whose
lookup overlaps the mutation may finish with the previously admitted rights.
This does not cancel in-flight handlers or enforce a second check at commit.

On a cache miss, membership, roles and permissions are loaded together in a
PostgreSQL `REPEATABLE READ` transaction. This prevents mixing relationship rows
from different committed states. The version is a cache-selection fence, not an
exact snapshot revision: an overlapping fill may contain newer coherent rules
under an older key. Later lookups select the newer key regardless. Empty rule
sets are cached too. Role/permission ownership filtering remains; effective rules use the deterministic
DENY-overrides contract above.

### The JWT `aclVersion` is not trusted

The JWT's embedded version is a login/refresh snapshot, never the authorization
source. For example, a JWT carrying version 3 selects version 4 after an admin's
ACL mutation commits. Old `auth:org:aclv:v1:{orgId}` Redis values are ignored.
`RBAC_ACLV_CACHE_TTL_MS` is deprecated: it still accepts nonnegative integers
(default `0`), but **both zero and positive values are ignored**.
`OrgAclVersionService.invalidate()` remains a compatibility no-op.

### Failures and extension rules

For JWT authorization using organization permissions, a missing organization
fails with `404`; an API key fails live membership admission with `401`.
Database failures propagate through the existing exception filter (`503` for
recognized availability errors, `500` for unexpected failures). No cached
version or JWT version is used on failure. A permission Redis read, lock or
publication error also fails authorization; a completed database load alone is
not an availability fallback. Existing shared Redis reconnect/queue behavior is
unchanged, so this does not promise a bounded
response time during every outage. No new authorization retry is introduced.

When adding an ACL mutation, call `bumpAclVersionTx(orgId, tx)` inside the same
transaction as the write. A standalone bump is insufficient for an ACL write.
For shared organization system-role or permission-template changes, bump
**every affected organization** transactionally. Raw SQL, migrations and external
writers must honor the same rule; metadata-only changes that do not alter effective rules
need no bump. Do not rely on post-commit invalidation for correctness.

### Deployment and rollback

Upgrade **all API instances** and drain old instances, including their in-flight
requests, before relying on this freshness guarantee. Mixed-version operation is
unsupported for the guarantee: new mutations no longer invalidate the version
cache used by old readers. No cache scan, flush or namespace migration is needed.
New fills are coherent snapshots; historical permission payloads are not certified
as coherent. If every payload must originate from the new loader, allow the full
one-hour TTL to elapse after the old processes are drained. Rollback restores the
old cache limitations; retaining the deprecated environment variable does not
preserve the repaired guarantee. Monitor primary database load and pool pressure:
warm org-scoped JWT authorization now requires a database round-trip.

---

## Managing roles, permissions & members

Role, permission and member management require verified matching organization
context and full `TeamAccess` authority as described above. A personal JWT selects
the path organization directly; a legacy bound JWT must match that target.
Supported keys additionally require exact `manage:TeamAccess`. See
`/docs` for each route's credentials and exact shapes; the semantics that matter:

- **Roles list** is paginated and ordered `isSystem DESC, name ASC` so system
  roles head the list.
- **Roles and permissions are created separately** — the API does not accept
  inline permissions on role creation. Each permission is validated, audited,
  and linked on its own; the join row and the `aclVersion` bump are
  transactional.
- **Built-in roles** (`ADMIN`, `MEMBER`, `VIEWER`) and **built-in permissions**
  are seeded on first run (`pnpm --filter api db:seed`) and cannot be modified or
  deleted via the API.
- **Removing a member** from the org drops their org permissions immediately
  (next-request freshness); their profile-scoped access remains.

### Revoking access

To cut off a former member, remove them from the org. Because org-scoped checks
read the live ACL version per request, their access ends on the next request —
active JWTs do not keep stale org permissions alive until expiry.

---

## API keys and org permissions

Machine callers authenticate with scoped API keys instead of a JWT. A key is
**bound to one organization**, its raw value is shown once and stored only as a
salted SHA-256 hash, and each request is authorized against `userPerms ∩ scopes`
— the intersection of the creator's org permissions and the key's scopes. So a
key can never exceed its creator's access even if scoped broadly, and
`manage:all` is forbidden. Full model, scope grammar, and error codes:
[API Keys](./api-keys.md).

---

## See also

- [Controlled authorization upgrade](./authorization-upgrade.md) — audit, maintenance, recovery.
- [Concepts](./concepts.md) — tokens, sessions, the authentication model.
- [Sessions](./sessions.md) — rotation and revocation (incl. role-change revoke).
- [CSRF Posture](./csrf.md) — cookie surfaces and CSRF handling.
- [Auth API contracts](./reference.md) — error codes and environment variables.
