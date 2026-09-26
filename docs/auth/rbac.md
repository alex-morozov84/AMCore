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
except that a `SUPER_ADMIN` bypasses layer 2 entirely.

```
Request
  │
  ▼
Layer 1 — System role      USER        → normal access, continue to layer 2
                           SUPER_ADMIN → everything, always (skips layer 2)
  │
  ▼
Layer 2 — Org permissions  org membership + roles + permissions, evaluated by CASL
```

|                  | System role                      | Org permission                       |
| ---------------- | -------------------------------- | ------------------------------------ |
| **Scope**        | Platform-wide                    | Within one organization              |
| **Stored**       | User record + JWT claim          | Database + Redis cache               |
| **Granularity**  | Coarse (2 levels)                | Fine (action + subject + conditions) |
| **Changed by**   | `SUPER_ADMIN`                    | Org `ADMIN`                          |
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

The `systemRole` claim in the JWT is **necessary but not sufficient** on
`@SystemRoles` routes. On every privileged request the guard re-reads the
caller's **current** `systemRole` from the database and requires that **both**
the token claim **and** the live DB role satisfy the requirement
(`claim ∩ current DB role`). Consequences:

- **Demotion takes effect on the next request.** A demoted `SUPER_ADMIN`'s
  existing token — still cryptographically valid for up to its 15-minute
  lifetime — is rejected on `/admin/**` immediately.
- **Promotion requires a new token.** A freshly promoted user's existing token
  still carries the old `USER` claim; they gain admin access only after
  re-login mints a new token.
- **A system-role change revokes that user's sessions** (see
  [sessions.md](./sessions.md)), so a promotion cannot silently elevate an
  existing refresh session and a demoted admin is signed out.

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

### Org context in the JWT

Org permissions apply only once the JWT carries an `organizationId`. Obtain such
a token by calling the org-switch endpoint (`POST /organizations/:orgId/switch`),
then replace your access token with the returned one.

```json
{
  "sub": "cm1abc...",
  "systemRole": "USER",
  "organizationId": "org_xyz...",
  "aclVersion": 5
}
```

The org creator automatically becomes its `ADMIN`.

### Built-in org roles

A role is a named bundle of permissions. Three roles are seeded per org and
cannot be deleted:

| Role     | Permissions                                                                    |
| -------- | ------------------------------------------------------------------------------ |
| `ADMIN`  | `manage` on `Organization`, `Role`, `Permission`, `User` — full org management |
| `MEMBER` | `create`/`read` on `all`; `update` on own `User` record                        |
| `VIEWER` | `read` on `all`                                                                |

A member can hold multiple roles; their effective permissions are the union.
Beyond these, an `ADMIN` can define **custom roles** with exactly the
permissions the app needs.

### Permission shape

Roles grant nothing by themselves — permissions do. A permission is:

```
Permission {
  action:     "create" | "read" | "update" | "delete" | "manage"
  subject:    "User" | "Organization" | "Role" | "Permission" | "all"
  conditions: { "assignedToId": "${user.sub}" }   ← optional, row-level scope
  fields:     ["name", "email"]                    ← optional, field-level scope
  inverted:   false                                ← true = explicit DENY
}
```

- **action** — `manage` is the wildcard for all four concrete actions.
- **subject** — the resource type. `all` is the wildcard for every subject;
  `manage` + `all` = superuser within the org.

`action` and `subject` are **closed enums** (`Action` and `Subject` in
`packages/shared/src/enums/permissions.ts`). `assignPermissionSchema` validates
both, so an off-enum value returns `400 Bad Request`. Domain subjects
(`Contact`, `Deal`, …) are **not** built in — a fork adds them (see
[Adding your own subjects](#adding-your-own-subjects)).

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

## The CASL policy model

Authorization is enforced with [CASL](https://casl.js.org). The server builds an
`AppAbility` from the caller's org permissions and checks it three ways.

**Method-level policy check** — the common case:

```typescript
import { CheckPolicies } from '@/core/auth/decorators/check-policies.decorator'
import { Action, Subject } from '@amcore/shared'

@CheckPolicies(ability => ability.can(Action.Read, Subject.Contact))
@Get('/contacts')
getContacts() { ... }
```

**Combined with an auth type:**

```typescript
@Auth(AuthType.Bearer)
@CheckPolicies(ability => ability.can(Action.Create, Subject.Contact))
@Post('/contacts')
createContact(@Body() dto: CreateContactDto) { ... }
```

**Manual check inside a service** — when the decision depends on the loaded row:

```typescript
const ability = await this.abilityFactory.createForUser(userId, orgId)
if (!ability.can('update', subject('Contact', { assignedToId: userId }))) {
  throw new ForbiddenException()
}
```

For list/read paths, let CASL generate the `WHERE` clause instead of hand-writing
filters — see the next section.

---

## Adding your own subjects

Out of the box, permissions cover `User`, `Organization`, `Role`, and
`Permission`. To protect your own domain models:

**1. Extend the `Subject` enum** in `packages/shared/src/enums/permissions.ts`
and rebuild `@amcore/shared` (skipping the rebuild leaves the API rejecting the
new subject with `400`):

```typescript
export enum Subject {
  User = 'User',
  Organization = 'Organization',
  Role = 'Role',
  Permission = 'Permission',
  Contact = 'Contact', // ← your subjects
  Deal = 'Deal',
  All = 'all',
}
```

**2. Guard the controller** with `@CheckPolicies` (see above).

**3. Filter reads with `accessibleBy`** so scope conditions apply automatically. `@casl/prisma`
v2's `accessibleBy` no longer throws on its own — an unsatisfiable condition can otherwise
surface as a raw Prisma query error instead of failing closed cleanly, because Prisma doesn't
reliably mock an empty `OR` ([prisma/prisma#17367](https://github.com/prisma/prisma/issues/17367)).
Extend the Prisma Client with `createCaslExtension()` **before** the first `accessibleBy()`
call — AMCore does not wire this extension in by default since nothing in the starter calls
`accessibleBy()` yet:

```typescript
import { accessibleBy, createCaslExtension } from '@casl/prisma'

// Once, wherever the Prisma Client is constructed:
const prisma = new PrismaClient().$extends(createCaslExtension())

@Get('/contacts')
findAll(@CurrentAbility() ability: AppAbility) {
  return this.prisma.contact.findMany({
    where: accessibleBy(ability).Contact, // WHERE clause derived from permissions
  })
}
```

An `ADMIN` then sees all contacts and a `MEMBER` with a conditional permission
sees only their own — with zero branching in the service.

**4. Seed or grant permissions** for the new subject — add them to
`prisma/seed.ts`, or let org admins create them at runtime via the roles API.

---

## Freshness & caching

Every org-scoped JWT authorization reads the current organization `aclVersion`
from the **primary database**, even when the permission payload is cached. API
keys already read the current version during live membership admission.

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
sets are cached too. Existing role filtering and permission ordering remain in
effect; this mechanism does not redefine authorization semantics.

### The JWT `aclVersion` is not trusted

The JWT's embedded version is a login/refresh snapshot, never the authorization
source. For example, a JWT carrying version 3 selects version 4 after an admin's
ACL mutation commits. Old `auth:org:aclv:v1:{orgId}` Redis values are ignored.
`RBAC_ACLV_CACHE_TTL_MS` is deprecated: it still accepts nonnegative integers
(default `0`), but **both zero and positive values are ignored**.
`OrgAclVersionService.invalidate()` remains a compatibility no-op.

### Failures and extension rules

A missing organization fails with `404`; database failures propagate through the
existing exception filter (`503` for recognized availability errors, `500` for
unexpected failures). No cached version or JWT version is used on failure. A
permission Redis read, lock or publication error also fails authorization; a
completed database load alone is not an availability fallback. Existing shared
Redis reconnect/queue behavior is unchanged, so this does not promise a bounded
response time during every outage. No new authorization retry is introduced.

When adding an ACL mutation, call `bumpAclVersionTx(orgId, tx)` inside the same
transaction as the write. A standalone bump is insufficient for an ACL write.
For shared system-role or permission-template changes, bump **every affected
organization** transactionally. Raw SQL, migrations and external writers must
honor the same rule; metadata-only changes that do not alter effective rules
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

All management routes require an org-context JWT (call `/switch` first) and the
`ADMIN` role. See `/docs` for exact shapes; the semantics that matter:

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

- [Concepts](./concepts.md) — tokens, sessions, the authentication model.
- [Sessions](./sessions.md) — rotation and revocation (incl. role-change revoke).
- [CSRF Posture](./csrf.md) — cookie surfaces and CSRF handling.
- [Auth API contracts](./reference.md) — error codes and environment variables.
