import {
  type Organization,
  type OrgMember,
  type Permission,
  Prisma,
  type Role,
} from '../src/generated/prisma/client'

import type { AuthorizationDbFixture } from './authorization-db.fixture'

/** Exact historical seed, intentionally separate from current production defaults. */
export async function seedLegacyAuthorization(db: AuthorizationDbFixture): Promise<{
  permissions: Permission[]
  roles: Role[]
  organizations: Organization[]
  members: OrgMember[]
}> {
  const definitions = [
    ['manage', 'Organization'],
    ['manage', 'Role'],
    ['manage', 'Permission'],
    ['manage', 'User'],
    ['update', 'User'],
    ['create', 'all'],
    ['read', 'all'],
  ]
  const permissions: Permission[] = []
  for (const [action, subject] of definitions) {
    permissions.push(
      await db.prisma.permission.create({
        data: {
          action: action!,
          subject: subject!,
          ...(action === 'update' ? { conditions: { id: '${user.sub}' } } : {}),
        },
      })
    )
  }
  const roles: Role[] = []
  for (const [name, indexes] of Object.entries({
    ADMIN: [0, 1, 2, 3],
    MEMBER: [4, 5, 6],
    VIEWER: [6],
  })) {
    roles.push(
      await db.prisma.role.create({
        data: {
          name,
          isSystem: true,
          permissions: {
            create: indexes.map((index) => ({ permissionId: permissions[index]!.id })),
          },
        },
      })
    )
  }
  const organizations: Organization[] = []
  const members: OrgMember[] = []
  for (const [index, role] of roles.entries()) {
    const org = await db.prisma.organization.create({
      data: { name: `Org ${index}`, slug: `org-${index}`, aclVersion: 12 },
    })
    const email = `fixture-${index}@example.com`
    const user = await db.prisma.user.create({
      data: { email, emailCanonical: email, emailVerified: true },
    })
    const member = await db.prisma.orgMember.create({
      data: { userId: user.id, organizationId: org.id, roles: { create: { roleId: role.id } } },
    })
    organizations.push(org)
    members.push(member)
  }
  return { permissions, roles, organizations, members }
}

export function permissionSignature(permission: {
  action: string
  subject: string
  conditions: Prisma.JsonValue
  fields: string[]
  inverted: boolean
}): Pick<Permission, 'action' | 'subject' | 'conditions' | 'fields' | 'inverted'> {
  return {
    action: permission.action,
    subject: permission.subject,
    conditions: permission.conditions,
    fields: permission.fields,
    inverted: permission.inverted,
  }
}
