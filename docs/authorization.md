# Authorization

Control who can do what in your app — from a simple single-user setup to a full multi-tenant SaaS with custom roles and fine-grained permissions.

---

## Table of contents

- [Concepts](#concepts)
- [Getting started](#getting-started)
- [Managing roles & permissions](#managing-roles--permissions)
- [Adding your own subjects](#adding-your-own-subjects)
- [Common scenarios](#common-scenarios)
- [System roles](#system-roles)
- [Reference](#reference)

---

## Concepts

### System roles

Every user has a **system role** — a server-wide access level assigned by an admin.

| Role          | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `USER`        | Default for all new registrations. Works solo or inside an org. |
| `SUPER_ADMIN` | Full server access: all users, all orgs, queue dashboard.       |

### Organizations

An **organization** is a shared workspace for a team. It's optional — users can work solo without one.

Create an org when you need multiple users to collaborate with different levels of access.

### Organization roles

Inside an org, users are assigned **roles**. Three are built in:

| Role     | Description                                       |
| -------- | ------------------------------------------------- |
| `ADMIN`  | Full org management: members, roles, permissions. |
| `MEMBER` | Create and read any resource, update own profile. |
| `VIEWER` | Read-only access to any resource.                 |

You can also create **custom roles** with exactly the permissions your app needs.

### Permissions

Roles don't grant access on their own — **permissions** do. A role is just a named container for permissions.

Each permission has:

- **action** — what the user can do: `create`, `read`, `update`, `delete`, or `manage` (all of the above)
- **subject** — which resource type: `User`, `Organization`, `Role`, `Permission`, or any custom subject you define (e.g. `Contact`, `Deal`)
- **conditions** _(optional)_ — limits the rule to specific records, e.g. only records owned by the current user

### Org context in the JWT

Role permissions only apply after you call `/switch` to get a token that includes your org. Without org context, you can only read and update your own profile.

---

## Getting started

### 1. Register and log in

```http
POST /api/v1/auth/register
POST /api/v1/auth/login
```

New users get the `USER` system role automatically. No setup needed for personal use.

### 2. Create an organization

```http
POST /api/v1/organizations
Content-Type: application/json

{
  "name": "Acme Corp",
  "slug": "acme"
}
```

The user who creates the org automatically becomes its `ADMIN`.

### 3. Invite members

First, list the roles to find the ID of the role you want to assign:

```http
GET /api/v1/organizations/:orgId/roles
```

Then invite by email:

```http
POST /api/v1/organizations/:orgId/members/invite
Content-Type: application/json

{
  "email": "john@acme.com",
  "roleId": "<role-id>"
}
```

> The invited user must already have an account.

### 4. Switch to org context

```http
POST /api/v1/organizations/:orgId/switch
```

Returns a new access token. Replace your current token with it — all subsequent requests will be evaluated against your org permissions.

---

## Managing roles & permissions

All management endpoints require org context in the JWT (call `/switch` first) and the `ADMIN` role.

### Roles

**List roles in an org:**

```http
GET /api/v1/organizations/:orgId/roles
```

**Create a custom role:**

```http
POST /api/v1/organizations/:orgId/roles
Content-Type: application/json

{ "name": "Sales Manager", "description": "Can manage all deals" }
```

**Update a custom role:**

```http
PATCH /api/v1/organizations/:orgId/roles/:roleId
Content-Type: application/json

{ "name": "Deal Manager" }
```

**Delete a custom role:**

```http
DELETE /api/v1/organizations/:orgId/roles/:roleId
```

> Built-in roles (`ADMIN`, `MEMBER`, `VIEWER`) cannot be deleted.

### Permissions

**Assign a permission to a role:**

```http
POST /api/v1/organizations/:orgId/roles/:roleId/permissions
Content-Type: application/json

{ "action": "manage", "subject": "Deal" }
```

To limit a permission to the user's own records, add a condition:

```json
{
  "action": "read",
  "subject": "Deal",
  "conditions": { "assignedToId": "${user.sub}" }
}
```

`${user.sub}` is resolved to the current user's ID at request time.

**Remove a permission from a role:**

```http
DELETE /api/v1/organizations/:orgId/roles/:roleId/permissions/:permId
```

### Members

**Assign a role to a member** (a member can have multiple roles):

```http
POST /api/v1/organizations/:orgId/members/:userId/roles/:roleId
```

**Remove a role from a member:**

```http
DELETE /api/v1/organizations/:orgId/members/:userId/roles/:roleId
```

**Remove a member from the org:**

```http
DELETE /api/v1/organizations/:orgId/members/:userId
```

---

## Adding your own subjects

Out of the box, permissions work with `User`, `Organization`, `Role`, and `Permission`. When you add domain models to your app — `Contact`, `Deal`, `Invoice`, etc. — you'll want to protect them too.

**Step 1.** Add your subjects to `packages/shared/src/enums/permissions.ts`:

```typescript
export enum Subject {
  User = 'User',
  Organization = 'Organization',
  Role = 'Role',
  Permission = 'Permission',
  Contact = 'Contact', // ← add your subjects here
  Deal = 'Deal',
  All = 'all',
}
```

**Step 2.** Protect your controller endpoints with `@CheckPolicies`:

```typescript
import { CheckPolicies } from '../auth/decorators/check-policies.decorator'
import { Action, Subject } from '@amcore/shared'

@CheckPolicies(ability => ability.can(Action.Read, Subject.Contact))
@Get('contacts')
findAll() { ... }
```

**Step 3.** In your service, use `accessibleBy` to automatically filter records by what the current user is allowed to see:

```typescript
import { accessibleBy } from '@casl/prisma'

@Get('contacts')
findAll(@CurrentAbility() ability: AppAbility) {
  return this.prisma.contact.findMany({
    where: accessibleBy(ability).Contact  // ← WHERE clause auto-generated from permissions
  })
}
```

This means an `ADMIN` sees all contacts, a `MEMBER` with a conditions-based permission sees only their own — with zero `if` statements in your service.

**Step 4.** Seed permissions for your new subjects (or let org admins create them via the API):

```typescript
// In prisma/seed.ts — add to the system permissions
prisma.permission.create({ data: { action: 'manage', subject: 'Contact' } })
```

---

## Common scenarios

### "I want John to read contacts but not delete them"

Create a role, add a `read` permission, assign it to John:

```http
# 1. Create role
POST /api/v1/organizations/:orgId/roles
{ "name": "Contact Viewer" }

# 2. Add read permission
POST /api/v1/organizations/:orgId/roles/:roleId/permissions
{ "action": "read", "subject": "Contact" }

# 3. Assign role to John
POST /api/v1/organizations/:orgId/members/:johnId/roles/:roleId
```

### "Managers see all deals, sales reps see only their own"

Create two roles with different conditions on the same subject:

```http
# Create Manager role and assign full read
POST /api/v1/organizations/:orgId/roles
{ "name": "Manager" }

POST /api/v1/organizations/:orgId/roles/:managerRoleId/permissions
{ "action": "read", "subject": "Deal" }

# Create Sales Rep role and assign conditional read
POST /api/v1/organizations/:orgId/roles
{ "name": "Sales Rep" }

POST /api/v1/organizations/:orgId/roles/:salesRepRoleId/permissions
{
  "action": "read",
  "subject": "Deal",
  "conditions": { "assignedToId": "${user.sub}" }
}
```

Your service code stays the same for both roles — the server generates the right `WHERE` clause per user automatically.

### "I need to immediately revoke a former employee's access"

Remove them from the org:

```http
DELETE /api/v1/organizations/:orgId/members/:userId
```

Their org permissions are gone immediately. Active JWT tokens expire within 15 minutes (the default access token lifetime).

### "I want a read-only integration via API key" _(coming in Phase 3)_

API key authentication with scopes is planned. You'll create a key with `scopes: ["read"]` — it will only be able to perform read operations regardless of the associated user's full role.

---

## System roles

### Promoting a user to SUPER_ADMIN

You need an existing `SUPER_ADMIN` account to use the admin API:

```http
PATCH /api/v1/admin/users/:userId
Content-Type: application/json

{ "systemRole": "SUPER_ADMIN" }
```

**For the first SUPER_ADMIN**, update the record directly in the database:

```sql
UPDATE core.users
SET "systemRole" = 'SUPER_ADMIN'
WHERE email = 'admin@yourdomain.com';
```

### What SUPER_ADMIN can do

| Endpoint                          | Description                        |
| --------------------------------- | ---------------------------------- |
| `GET /api/v1/admin/users`         | List all users (paginated)         |
| `PATCH /api/v1/admin/users/:id`   | Change any user's system role      |
| `GET /api/v1/admin/organizations` | List all organizations (paginated) |
| `GET /admin/queues`               | Bull Board queue dashboard         |

---

## Reference

### Built-in permissions

| Role     | Action   | Subject        | Conditions      |
| -------- | -------- | -------------- | --------------- |
| `ADMIN`  | `manage` | `Organization` | —               |
| `ADMIN`  | `manage` | `Role`         | —               |
| `ADMIN`  | `manage` | `Permission`   | —               |
| `ADMIN`  | `manage` | `User`         | —               |
| `MEMBER` | `create` | `all`          | —               |
| `MEMBER` | `read`   | `all`          | —               |
| `MEMBER` | `update` | `User`         | own record only |
| `VIEWER` | `read`   | `all`          | —               |

Built-in permissions are seeded on first run (`pnpm --filter api db:seed`) and cannot be modified via the API.

### Actions

| Action   | Meaning                 |
| -------- | ----------------------- |
| `create` | Create new records      |
| `read`   | Read and list records   |
| `update` | Update existing records |
| `delete` | Delete records          |
| `manage` | All of the above        |

### Condition variables

| Variable      | Resolves to       |
| ------------- | ----------------- |
| `${user.sub}` | Current user's ID |
