import {
  ORG_DEFAULT_PERMISSIONS,
  ORG_DEFAULT_ROLE_GRANTS,
} from '../src/core/auth/casl/org-role-defaults'
import { Prisma, type PrismaClient } from '../src/generated/prisma/client'

function signature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(signature).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${signature(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Clean installation or exact-v2 no-op only; installed policies need migration. */
export async function seedOrgRoles(prisma: Pick<PrismaClient, '$transaction'>): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`LOCK TABLE core.organizations, core.org_members, core.member_roles, core.roles, core.role_permissions, core.permissions IN SHARE ROW EXCLUSIVE MODE`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(170017001)`
    const names = Object.keys(ORG_DEFAULT_ROLE_GRANTS)
    const roles = await tx.role.findMany({
      where: { name: { in: names }, organizationId: null },
      include: { permissions: { include: { permission: true } } },
    })
    if (roles.length > 0) {
      if (
        roles.length !== 3 ||
        new Set(roles.map((role) => role.name)).size !== 3 ||
        roles.some((role) => !role.isSystem)
      )
        throw new Error('Ambiguous system templates; audit and recover before seed')
      for (const role of roles) {
        const indexes = ORG_DEFAULT_ROLE_GRANTS[role.name as keyof typeof ORG_DEFAULT_ROLE_GRANTS]
        const expected = indexes.map((index) => ORG_DEFAULT_PERMISSIONS[index]!)
        if (role.permissions.length !== expected.length)
          throw new Error('Installed templates require controlled migration')
        for (const rule of expected) {
          const actual = role.permissions.find((link) => link.permissionId === rule.id)?.permission
          if (
            !actual ||
            actual.organizationId !== null ||
            signature({
              id: actual.id,
              action: actual.action,
              subject: actual.subject,
              conditions: actual.conditions,
              fields: actual.fields,
              inverted: actual.inverted,
            }) !== signature(rule)
          )
            throw new Error('Installed templates require controlled migration')
        }
      }
      return
    }
    const collisions = await tx.permission.count({
      where: {
        OR: [
          { id: { in: ORG_DEFAULT_PERMISSIONS.map((rule) => rule.id) } },
          { subject: 'TeamAccess' },
        ],
      },
    })
    if (collisions) throw new Error('Reserved permission collision; audit before seed')
    await tx.permission.createMany({
      data: ORG_DEFAULT_PERMISSIONS.map((rule) => ({
        ...rule,
        conditions: rule.conditions === null ? Prisma.DbNull : rule.conditions,
      })),
    })
    for (const [name, indexes] of Object.entries(ORG_DEFAULT_ROLE_GRANTS)) {
      const role = await tx.role.create({ data: { name, isSystem: true } })
      await tx.rolePermission.createMany({
        data: indexes.map((index) => ({
          roleId: role.id,
          permissionId: ORG_DEFAULT_PERMISSIONS[index]!.id,
        })),
      })
    }
  })
}
