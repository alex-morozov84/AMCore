/* eslint-disable no-console */
import { PrismaClient, type Role } from '@prisma/client'

const prisma = new PrismaClient()

async function findOrCreateRole(name: string, description: string): Promise<Role> {
  const existing = await prisma.role.findFirst({
    where: { name, organizationId: null, isSystem: true },
  })
  if (existing) return existing
  return prisma.role.create({ data: { name, description, isSystem: true } })
}

async function main(): Promise<void> {
  console.log('Seeding system roles and permissions...')

  // 1. Find or create system roles
  const [adminRole, memberRole, viewerRole] = await Promise.all([
    findOrCreateRole('ADMIN', 'Full organization management'),
    findOrCreateRole('MEMBER', 'Standard member access'),
    findOrCreateRole('VIEWER', 'Read-only access'),
  ])

  // 2. Skip if permissions already assigned (idempotent)
  const existingCount = await prisma.rolePermission.count({
    where: { roleId: adminRole.id },
  })
  if (existingCount > 0) {
    console.log('Permissions already seeded, skipping.')
    return
  }

  // 3. Create system permissions
  const [manageOrg, manageRole, managePerm, manageUser, updateOwnUser, createAll, readAll] =
    await Promise.all([
      prisma.permission.create({ data: { action: 'manage', subject: 'Organization' } }),
      prisma.permission.create({ data: { action: 'manage', subject: 'Role' } }),
      prisma.permission.create({ data: { action: 'manage', subject: 'Permission' } }),
      prisma.permission.create({ data: { action: 'manage', subject: 'User' } }),
      prisma.permission.create({
        data: { action: 'update', subject: 'User', conditions: { id: '${user.sub}' } },
      }),
      prisma.permission.create({ data: { action: 'create', subject: 'all' } }),
      prisma.permission.create({ data: { action: 'read', subject: 'all' } }),
    ])

  // 4. Assign permissions to roles
  await prisma.rolePermission.createMany({
    data: [
      // ADMIN: full organization management
      { roleId: adminRole.id, permissionId: manageOrg.id },
      { roleId: adminRole.id, permissionId: manageRole.id },
      { roleId: adminRole.id, permissionId: managePerm.id },
      { roleId: adminRole.id, permissionId: manageUser.id },
      // MEMBER: create + read all, update own profile
      { roleId: memberRole.id, permissionId: createAll.id },
      { roleId: memberRole.id, permissionId: readAll.id },
      { roleId: memberRole.id, permissionId: updateOwnUser.id },
      // VIEWER: read only
      { roleId: viewerRole.id, permissionId: readAll.id },
    ],
  })

  console.log('Seeded: 3 system roles, 7 permissions')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
