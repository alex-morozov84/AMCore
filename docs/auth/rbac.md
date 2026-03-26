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
  subject:    "Contact" | "User" | "Organization" | "all"
  conditions: { "assignedToId": "${user.id}" }   ← optional, limits scope
  fields:     ["name", "email"]                   ← optional, field-level
  inverted:   false                               ← true = explicit DENY
}
```

**Actions:**

- `create`, `read`, `update`, `delete` — specific operations
- `manage` — wildcard for all actions on a subject

**Subjects:**

- Named resources: `Contact`, `User`, `Organization`, `Role`, `Permission`
- `all` — wildcard for every subject (combined with `manage` = superuser)

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
Cache key: perm:{orgId}:{userId}:{aclVersion}
TTL:       1 hour
```

When an admin changes roles or permissions, `aclVersion` on the organization is incremented. The next request from affected users will use a new cache key (miss → fresh load). Old cache entries expire naturally.

**This means:** Permission changes take effect on the **next request** after the version bump — no need to sign out.

---

## aclVersion and stale tokens

The JWT contains `aclVersion` at the time of login/refresh. When the backend loads permissions, it uses this version as part of the cache key.

```
User logs in  → JWT has aclVersion: 3
Admin changes permissions → org.aclVersion becomes 4
User's next request → JWT still says 3 → cache miss → loads fresh aclVersion: 4 permissions
```

Old permissions (version 3) are loaded from cache if any user still has an older token — but they expire within 1 hour and the next refresh token cycle will embed the new version.

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
curl -X POST https://api.amcore.dev/api/v1/organizations/org_xyz/members \
  -H "Authorization: Bearer eyJhbGci..." \
  -d '{"userId": "cm1abc...", "roleIds": ["role_admin"]}'
```

### Create a role

```bash
curl -X POST https://api.amcore.dev/api/v1/organizations/org_xyz/roles \
  -H "Authorization: Bearer eyJhbGci..." \
  -d '{
    "name": "Editor",
    "permissions": [
      { "action": "create", "subject": "Contact" },
      { "action": "read",   "subject": "Contact" },
      { "action": "update", "subject": "Contact", "conditions": {"assignedToId": "${user.id}"} }
    ]
  }'
```

---

## System roles vs org permissions — summary

|                          | System Role       | Org Permission                       |
| ------------------------ | ----------------- | ------------------------------------ |
| **Scope**                | Platform-wide     | Within one org                       |
| **Where stored**         | User record + JWT | Database + Redis cache               |
| **Granularity**          | Coarse (2 levels) | Fine (action + subject + conditions) |
| **Who changes it**       | SUPER_ADMIN       | Org admin                            |
| **When it takes effect** | Next login        | Next request                         |
