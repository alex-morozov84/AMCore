import {
  ORG_DEFAULT_PERMISSIONS,
  ORG_DEFAULT_ROLE_GRANTS,
} from '../src/core/auth/casl/org-role-defaults.js'
import { hasCanonicalTemplate } from '../src/core/organizations/system-template-validation.js'
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js'

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
      if (roles.some((role) => !hasCanonicalTemplate(role)))
        throw new Error('Installed templates require controlled migration')
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
