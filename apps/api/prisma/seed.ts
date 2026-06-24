/* eslint-disable no-console */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Role } from '@prisma/client'
import { config } from 'dotenv'
import { Pool } from 'pg'

import { seedAiCatalog } from './seed-ai-catalog'

// Prisma 7 requires a driver adapter; mirror prisma.config.ts so `prisma db seed`
// (and a standalone `tsx prisma/seed.ts`) resolve `DATABASE_URL` and connect.
config({ path: '../../.env' })

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function findOrCreateRole(name: string, description: string): Promise<Role> {
  const existing = await prisma.role.findFirst({
    where: { name, organizationId: null, isSystem: true },
  })
  if (existing) return existing
  return prisma.role.create({ data: { name, description, isSystem: true } })
}

async function main(): Promise<void> {
  console.log('Seeding system roles and permissions...')

  // 0. AI catalog (idempotent upsert; independent of the permission guard below)
  await seedAiCatalog(prisma)

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
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
