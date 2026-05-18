# RBAC — Roles, Permissions & Organizations

Role-Based Access Control (RBAC) is how the system decides what authenticated users are allowed to do. AMCore has two independent layers: a simple system-wide role and a flexible per-organization permission system.

---

## The two layers

```
Request comes in
      │
      ▼
┌─────────────────────────────────────────┐
│  Layer 1: System Role                   │
│                                         │
│  USER          →  normal access         │
│  SUPER_ADMIN   →  everything, always    │
└─────────────────────────────────────────┘
      │ (if USER, continue)
      ▼
┌─────────────────────────────────────────┐
│  Layer 2: Organization Permissions      │
│                                         │
│  org member  +  role  +  permissions   │
│  → evaluated by CASL                   │
└─────────────────────────────────────────┘
```

Both layers must pass. A `SUPER_ADMIN` bypasses layer 2 entirely.

---

## System roles

System roles are stored in the JWT and apply everywhere in the platform.

| Role          | Assigned to             | What they can do                                     |
| ------------- | ----------------------- | ---------------------------------------------------- |
| `USER`        | Everyone by default     | Normal platform access                               |
| `SUPER_ADMIN` | Platform administrators | Full access to everything, including the admin panel |

`SUPER_ADMIN` is granted manually (no endpoint to self-promote). It's meant for the platform owner(s).

**In NestJS controllers:**

```typescript
@SystemRoles(SystemRole.SuperAdmin)
@Get('/admin/users')
getAllUsers() { ... }
```

---

## Organizations

An organization is a workspace. Users join organizations as members, and permissions are defined per organization.

```
Organization "Acme Corp"
├── Member: alice  (roles: Admin)
├── Member: bob    (roles: Editor, Viewer)
└── Member: carol  (roles: Viewer)
```

A user can be a member of multiple organizations. Each membership has its own set of roles within that organization.

### Organization context in JWT

When a user is working within an organization, the JWT includes an `organizationId`:

```json
{
  "sub": "cm1abc...",
  "email": "alice@example.com",
  "systemRole": "USER",
  "organizationId": "org_xyz...",
  "aclVersion": 5
}
```

The frontend must set the organization context when making requests. Without `organizationId`, the user has minimal permissions (can only read/update their own profile).

---

## Roles and permissions

Roles are bundles of permissions. A permission defines what action can be performed on what resource.

### Permissions structure

```
Permission {
  action:     "create" | "read" | "update" | "delete" | "manage"
  subject:    "User" | "Organization" | "Role" | "Permission" | "all"
  conditions: { "assignedToId": "${user.id}" }   ← optional, limits scope
  fields:     ["name", "email"]                   ← optional, field-level
  inverted:   false                               ← true = explicit DENY
}
```

**Actions** (closed enum — `Action` in `@amcore/shared`):

- `create`, `read`, `update`, `delete` — specific operations
- `manage` — wildcard for all actions on a subject

**Subjects** (closed enum — `Subject` in
`packages/shared/src/enums/permissions.ts`):

- Built-in: `User`, `Organization`, `Role`, `Permission`
- `all` — wildcard for every subject (combined with `manage` =
  superuser)

> Per OB-01 the `assignPermissionSchema` validates both `action` and
> `subject` against these closed enums. To add a domain subject
> (`Contact`, `Deal`, `Invoice`, etc.) a fork must extend the
> `Subject` enum first; off-enum values now return `400 Bad Request`.

### Example permission set

| Role   | Action   | Subject   | Conditions                |
| ------ | -------- | --------- | ------------------------- |
| Admin  | `manage` | `all`     | —                         |
| Editor | `create` | `Contact` | —                         |
| Editor | `read`   | `Contact` | —                         |
| Editor | `update` | `Contact` | `assignedToId == user.id` |
| Viewer | `read`   | `Contact` | —                         |

The Editor can update Contacts, but **only ones assigned to themselves**. That's what `conditions` does — it's a runtime filter applied per-request.

---

## Conditions (field-level scoping)

Conditions use a template syntax with `${...}` placeholders that are resolved at runtime:

```json
{ "assignedToId": "${user.id}" }
{ "organizationId": "${org.id}" }
{ "status": "active" }
```

This lets you express rules like:

- "Can read Contacts, but only ones in your org"
- "Can update Users, but only yourself"
- "Can delete Reports, but only ones you created"

Conditions are evaluated by CASL after the permission is loaded — no custom query code needed.

---

## Checking permissions in NestJS

### Method-level policy check

```typescript
import { CheckPolicies } from '@/core/auth/decorators/check-policies.decorator';

@CheckPolicies(ability => ability.can('read', 'Contact'))
@Get('/contacts')
getContacts() { ... }
```

### Combined auth + policy

```typescript
@Auth(AuthType.Bearer)
@CheckPolicies(ability => ability.can('create', 'Contact'))
@Post('/contacts')
createContact(@Body() dto: CreateContactDto) { ... }
```

### Manual check inside a service

```typescript
import { AbilityFactory } from '@/core/auth/casl/ability.factory';

constructor(private abilityFactory: AbilityFactory) {}

async updateContact(userId: string, orgId: string, contactId: string, data: any) {
  const ability = await this.abilityFactory.createForUser(userId, orgId);

  if (!ability.can('update', subject('Contact', { assignedToId: userId }))) {
    throw new ForbiddenException();
  }
  // proceed
}
```

---

## Permission caching

Loading permissions from the database on every request would be slow. Instead, permissions are cached in Redis with a version-based invalidation strategy.

```
Current org ACL version: auth:org:aclv:v1:{orgId}
Permissions cache key:   auth:perm:v2:{orgId}:{userId}:{aclVersion}
Permissions TTL:         1 hour
```

When an admin changes memberships, roles, or permissions, the ACL mutation and the organization's `aclVersion` increment commit in the same database transaction. After that commit, the server invalidates the cached current ACL version for the organization.

On the next authenticated org-scoped request, the backend reads the current org `aclVersion` and uses it in the permissions cache key. If the version changed, the request misses the old permission cache entry and loads fresh permissions. Old permission cache entries expire naturally.

**This means:** Permission changes take effect on the **next request** after the version bump — no need to sign out.

If Redis cannot be read, the server falls back to the database for the current `aclVersion`. If post-commit Redis invalidation fails, the mutation remains committed and the server records an error-level freshness incident with metric name `auth.rbac.aclv_invalidate_failure`; monitor this signal in production.

By default, the current ACL version cache has no TTL and relies on explicit invalidation. Setting `RBAC_ACLV_CACHE_TTL_MS` enables a bounded fallback mode where stale permission decisions can last up to that TTL if invalidation fails.

---

## aclVersion and stale tokens

The JWT contains `aclVersion` at the time of login/refresh, but the backend does not trust that embedded value for org-scoped authorization. It uses the token's org context to read the current organization `aclVersion` before building the ability.

```
User logs in  → JWT has aclVersion: 3
Admin changes permissions → org.aclVersion becomes 4
User's next request → JWT still says 3 → backend reads current aclVersion: 4 → cache miss → loads fresh permissions
```

The embedded JWT version is still useful as a snapshot/debug value, and the next refresh token cycle will embed the newer version. Authorization decisions use the server-side current version.

---

## Organizations API

### Create an organization

```bash
curl -X POST https://api.amcore.dev/api/v1/organizations \
  -H "Authorization: Bearer eyJhbGci..." \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp", "slug": "acme-corp"}'
```

### Add a member

```bash
curl -X POST https://api.amcore.dev/api/v1/organizations/org_xyz/members/invite \
  -H "Authorization: Bearer eyJhbGci..." \
  -d '{"email": "member@example.com", "roleId": "role_member"}'
```

### Create a role and attach permissions

Roles and permissions are created in two steps — the API does not
accept inline permissions on role creation. (Each permission needs
to be validated, audited, and linked separately; the join row plus
the `aclVersion` bump are transactional per ADR-035.)

```bash
# 1. Create the role
curl -X POST https://api.amcore.dev/api/v1/organizations/org_xyz/roles \
  -H "Authorization: Bearer eyJhbGci..." \
  -d '{ "name": "OrgManager", "description": "Org-scope manager" }'
# Response: { "id": "role_abc", "name": "OrgManager", ... }

# 2. Attach permissions one by one
curl -X POST https://api.amcore.dev/api/v1/organizations/org_xyz/roles/role_abc/permissions \
  -H "Authorization: Bearer eyJhbGci..." \
  -d '{ "action": "manage", "subject": "Organization" }'

curl -X POST https://api.amcore.dev/api/v1/organizations/org_xyz/roles/role_abc/permissions \
  -H "Authorization: Bearer eyJhbGci..." \
  -d '{ "action": "read", "subject": "User" }'
```

> **Subject must come from the `Subject` enum** in
> `packages/shared/src/enums/permissions.ts` (built-in: `User`,
> `Organization`, `Role`, `Permission`, `all`). To use a domain
> subject like `Contact` or `Deal`, extend the enum first and
> rebuild `@amcore/shared`; otherwise the request returns `400`
> (OB-01).

---

## System roles vs org permissions — summary

|                          | System Role       | Org Permission                       |
| ------------------------ | ----------------- | ------------------------------------ |
| **Scope**                | Platform-wide     | Within one org                       |
| **Where stored**         | User record + JWT | Database + Redis cache               |
| **Granularity**          | Coarse (2 levels) | Fine (action + subject + conditions) |
| **Who changes it**       | SUPER_ADMIN       | Org admin                            |
| **When it takes effect** | Next login        | Next request                         |
