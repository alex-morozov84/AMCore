import { CACHE_MANAGER } from '@nestjs/cache-manager'
import type { INestApplication } from '@nestjs/common'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import type { Role } from '@prisma/client'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import type { Cache } from 'cache-manager'
import { execSync } from 'child_process'
import cookieParser from 'cookie-parser'
import { ZodValidationPipe } from 'nestjs-zod'

import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma'

/**
 * Global test context with PostgreSQL and Redis containers
 */
export interface E2ETestContext {
  app: INestApplication
  prisma: PrismaService
  cache: Cache
  postgresContainer: StartedPostgreSqlContainer
  redisContainer: StartedRedisContainer
}

/**
 * Setup E2E test environment with TestContainers
 * - Starts PostgreSQL and Redis containers
 * - Initializes NestJS app
 * - Runs migrations
 */
export async function setupE2ETest(): Promise<E2ETestContext> {
  // Start PostgreSQL container
  const postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('amcore_test')
    .withUsername('test')
    .withPassword('test')
    .start()

  // Start Redis container
  const redisContainer = await new RedisContainer('redis:7-alpine').start()

  // Set environment variables
  const databaseUrl = postgresContainer.getConnectionUri()
  const redisUrl = redisContainer.getConnectionUrl()

  process.env.DATABASE_URL = databaseUrl
  process.env.REDIS_URL = redisUrl

  // Log test environment (suppress ESLint in tests)
  // eslint-disable-next-line no-console
  console.log('🔧 Test Environment:', { databaseUrl, redisUrl })

  // Create testing module with real AppModule (no mocks!)
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  // Create app instance
  const app = moduleFixture.createNestApplication()

  // Apply same configuration as in main.ts
  app.use(cookieParser())
  app.useGlobalPipes(new ZodValidationPipe())

  await app.init()

  // Get Prisma service and cache
  const prisma = app.get(PrismaService)
  const cache = app.get<Cache>(CACHE_MANAGER)

  // Run migrations
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS core')
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS fitness')
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS finance')
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS subscriptions')

  // Deploy migrations
  execSync('pnpm prisma migrate deploy', { stdio: 'inherit' })

  return { app, prisma, cache, postgresContainer, redisContainer }
}

/**
 * Cleanup E2E test environment
 * - Closes app
 * - Disconnects Prisma
 * - Stops containers
 */
export async function teardownE2ETest(context: E2ETestContext): Promise<void> {
  await context.app.close()
  await context.prisma.$disconnect()
  await context.postgresContainer.stop()
  await context.redisContainer.stop()
}

/**
 * Clean all tables in test database and reset Redis cache
 */
export async function cleanDatabase(prisma: PrismaService, cache: Cache): Promise<void> {
  // Delete in correct order (respecting foreign keys)
  await prisma.passwordResetToken.deleteMany()
  await prisma.emailVerificationToken.deleteMany()
  await prisma.session.deleteMany()
  await prisma.oAuthAccount.deleteMany()
  await prisma.userSettings.deleteMany()
  await prisma.user.deleteMany()

  // Reset Redis to clear rate limit counters between tests
  await cache.clear()
}

/**
 * Clean org-related data between tests.
 * Preserves system roles/permissions (organizationId = null).
 * Call before cleanDatabase to respect foreign key order.
 */
export async function cleanOrgData(prisma: PrismaService): Promise<void> {
  await prisma.permission.deleteMany({ where: { organizationId: { not: null } } })
  await prisma.role.deleteMany({ where: { organizationId: { not: null } } })
  await prisma.organization.deleteMany()
}

/**
 * Seed system roles and permissions required for RBAC tests.
 * Idempotent — safe to call multiple times.
 */
export async function seedSystemRoles(prisma: PrismaService): Promise<void> {
  const findOrCreate = async (name: string, description: string): Promise<Role> => {
    const existing = await prisma.role.findFirst({
      where: { name, organizationId: null, isSystem: true },
    })
    if (existing) return existing
    return prisma.role.create({ data: { name, description, isSystem: true } })
  }

  const [adminRole, memberRole, viewerRole] = await Promise.all([
    findOrCreate('ADMIN', 'Full organization management'),
    findOrCreate('MEMBER', 'Standard member access'),
    findOrCreate('VIEWER', 'Read-only access'),
  ])

  const alreadySeeded = await prisma.rolePermission.count({ where: { roleId: adminRole.id } })
  if (alreadySeeded > 0) return

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

  await prisma.rolePermission.createMany({
    data: [
      { roleId: adminRole.id, permissionId: manageOrg.id },
      { roleId: adminRole.id, permissionId: manageRole.id },
      { roleId: adminRole.id, permissionId: managePerm.id },
      { roleId: adminRole.id, permissionId: manageUser.id },
      { roleId: memberRole.id, permissionId: createAll.id },
      { roleId: memberRole.id, permissionId: readAll.id },
      { roleId: memberRole.id, permissionId: updateOwnUser.id },
      { roleId: viewerRole.id, permissionId: readAll.id },
    ],
  })
}
