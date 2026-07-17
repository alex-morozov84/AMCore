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

### Administering `SUPER_ADMIN`

Promote an existing user through the admin API (requires a current
`SUPER_ADMIN` session):

```http
PATCH /api/v1/admin/users/:userId
{ "systemRole": "SUPER_ADMIN" }
```

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

**3. Filter reads with `accessibleBy`** so scope conditions apply automatically:

```typescript
import { accessibleBy } from '@casl/prisma'

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

Org permissions are cached in Redis with version-based invalidation so most
requests avoid a database round-trip.

```
Current org ACL version:  auth:org:aclv:v1:{orgId}
Permissions cache key:     auth:perm:v2:{orgId}:{userId}:{aclVersion}
Permissions TTL:           1 hour
```

When an admin mutates memberships, roles, or permissions, the ACL change **and**
the organization's `aclVersion` increment commit in the **same database
transaction**. After that commit the server invalidates the cached current ACL
version. On the caller's next org-scoped request, the backend reads the current
`aclVersion`, keys the permission cache with it, misses the stale entry, and
loads fresh permissions.

**Effect: permission changes take effect on the _next request_ — no sign-out
required.**

### The JWT `aclVersion` is not trusted

The JWT embeds `aclVersion` at login/refresh time, but authorization **does not
trust that value**. It uses the token's org context to read the _current_
server-side `aclVersion` before building the ability:

```
Login             → JWT aclVersion: 3
Admin edits perms → org.aclVersion becomes 4
Next request      → JWT still says 3 → backend reads current 4 → cache miss → fresh load
```

The embedded value is a debug/snapshot only; the next refresh cycle re-embeds
the newer version.

### Redis fallback caveat

If Redis cannot be **read**, the server falls back to the database for the
current `aclVersion` — decisions stay correct, just uncached. If post-commit
Redis **invalidation** fails, the mutation remains committed and the server
records an error-level incident with metric `auth.rbac.aclv_invalidate_failure`
— monitor this in production. By default the ACL-version cache has no TTL and
relies on explicit invalidation; setting `RBAC_ACLV_CACHE_TTL_MS` enables a
bounded fallback where a stale decision can persist up to that TTL if
invalidation fails.

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
