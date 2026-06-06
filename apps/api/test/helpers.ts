import type { WorkerHost } from '@nestjs/bullmq'
import { CACHE_MANAGER } from '@nestjs/cache-manager'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { ThrottlerStorage } from '@nestjs/throttler'
import type { Role } from '@prisma/client'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import type { Cache } from 'cache-manager'
import { execSync } from 'child_process'
import cookieParser from 'cookie-parser'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'

import { EmailProcessor } from '../src/infrastructure/email/processors/email.processor'
import { RedisThrottlerStorage } from '../src/infrastructure/throttling'
import { PrismaService } from '../src/prisma'

/**
 * No-op PinoLogger stub for e2e. Per ai/TESTING.md "Known NestJS E2E Runtime
 * Caveat": once the Nest DI graph grows (OB-02 Stage D added the EmailModule
 * import + InviteService email deps to OrganizationsModule), the real
 * `nestjs-pino` provider makes `Test.createTestingModule(...).compile()` hang
 * indefinitely under Jest + ts-jest ESM — InstanceLoader stops mid-bootstrap
 * with no thrown error. Overriding only the logger sidesteps it. This is a
 * test-harness workaround; production logging is unchanged.
 */
export const noopPinoLogger = {
  setContext: () => undefined,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  assign: () => undefined,
} as unknown as PinoLogger

/**
 * Global test context with PostgreSQL and Redis containers
 */
export interface E2ETestContext {
  app: INestApplication
  prisma: PrismaService
  cache: Cache
  throttlerStorage: RedisThrottlerStorage
  postgresContainer: StartedPostgreSqlContainer
  redisContainer: StartedRedisContainer
}

export async function setupE2ETestInfrastructure(): Promise<
  Pick<E2ETestContext, 'postgresContainer' | 'redisContainer'>
> {
  const postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('amcore_test')
    .withUsername('test')
    .withPassword('test')
    .start()
  const redisContainer = await new RedisContainer('redis:7-alpine').start()
  return { postgresContainer, redisContainer }
}

/**
 * Setup E2E test environment with TestContainers
 * - Starts PostgreSQL and Redis containers
 * - Initializes NestJS app
 * - Runs migrations
 */
export async function setupE2ETest(): Promise<E2ETestContext> {
  const { postgresContainer, redisContainer } = await setupE2ETestInfrastructure()

  // Set environment variables
  const databaseUrl = postgresContainer.getConnectionUri()
  const redisUrl = redisContainer.getConnectionUrl()

  process.env.DATABASE_URL = databaseUrl
  process.env.REDIS_URL = redisUrl
  // Keep readiness e2e deterministic on developer machines where the root
  // APFS volume may legitimately report >90% used.
  process.env.HEALTH_DISK_THRESHOLD_PERCENT = '0.99'
  // E2E_DATABASE_URL: escape hatch consumed by prisma.config.ts to defeat
  // Prisma CLI's `.env` auto-load (which otherwise overrides DATABASE_URL back
  // to whatever sits in .env). Not used by application code.
  process.env.E2E_DATABASE_URL = databaseUrl

  // Log test environment (suppress ESLint in tests)
  // eslint-disable-next-line no-console
  console.log('🔧 Test Environment:', { databaseUrl, redisUrl })

  // Dynamic import AFTER process.env is set — otherwise AppModule's
  // ConfigModule.forRoot() evaluates at static-import time with the .env file
  // values and ignores our testcontainer URLs. See @nestjs/config issue #245.
  const { AppModule } = await import('../src/app.module')

  // Create testing module with real AppModule (no mocks!). Only PinoLogger is
  // overridden — see noopPinoLogger above and ai/TESTING.md for why this is
  // required once the DI graph grows.
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PinoLogger)
    .useValue(noopPinoLogger)
    .compile()

  // Create app instance
  const app = moduleFixture.createNestApplication()

  // Apply same configuration as in main.ts
  app.use(cookieParser())
  app.useGlobalPipes(new ZodValidationPipe())

  await app.init()

  // Get Prisma service and cache
  const prisma = app.get(PrismaService)
  const cache = app.get<Cache>(CACHE_MANAGER)
  // Resolve via the ThrottlerStorage token (what the guard actually uses), so
  // the e2e wiring assertion proves the guard is backed by the Redis storage,
  // not the in-memory fallback.
  const throttlerStorage = app.get<RedisThrottlerStorage>(ThrottlerStorage as never)

  // Run migrations
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS core')
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS fitness')
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS finance')
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS subscriptions')

  // Deploy migrations against the testcontainer DB. We pass `env` explicitly
  // because Jest's jest-environment-node sandboxes `process.env` and child
  // processes spawned via execSync's default inheritance do NOT see mutations
  // made by the test (verified empirically — DATABASE_URL was undefined in the
  // subprocess despite being set on `process.env` above). Forwarding
  // `E2E_DATABASE_URL` lets `prisma.config.ts` pick the testcontainer URL
  // instead of the `.env`-derived production one.
  execSync('pnpm prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, E2E_DATABASE_URL: databaseUrl },
  })

  return { app, prisma, cache, throttlerStorage, postgresContainer, redisContainer }
}

/**
 * Cleanup E2E test environment
 * - Closes app
 * - Disconnects Prisma
 * - Stops containers
 */
export async function teardownE2ETest(context: E2ETestContext): Promise<void> {
  await closeBullWorkers(context.app)
  await context.app.close()
  await context.redisContainer.stop({ timeout: 10_000 })
  await context.postgresContainer.stop({ timeout: 10_000 })
  // Testcontainers closes Docker/Reaper sockets asynchronously shortly after stop().
  // Let them settle before Jest decides the suite leaked an open handle.
  await new Promise((resolve) => setTimeout(resolve, 5_000))
}

async function closeBullWorkers(app: INestApplication): Promise<void> {
  await Promise.all([closeBullWorker(app, EmailProcessor)])
}

async function closeBullWorker(
  app: INestApplication,
  processor: new (...args: never[]) => WorkerHost
): Promise<void> {
  try {
    await app.get(processor, { strict: false }).worker.close(true)
  } catch {
    // Processor may be absent in focused test modules or not registered yet.
  }
}

/**
 * Clean all tables in test database and reset Redis cache
 */
export async function cleanDatabase(
  prisma: PrismaService,
  cache: Cache,
  throttlerStorage?: RedisThrottlerStorage
): Promise<void> {
  // Delete in correct order (respecting foreign keys)
  await prisma.passwordResetToken.deleteMany()
  await prisma.emailVerificationToken.deleteMany()
  await prisma.session.deleteMany()
  await prisma.oAuthAccount.deleteMany()
  await prisma.userSettings.deleteMany()
  await prisma.user.deleteMany()

  // Flush Redis directly — cache.clear() with @keyv/redis filters keys by '::' and
  // misses rate limiter keys like `rate:login_ip:...` that lack a namespace separator.
  type KeyvStore = { _store?: KeyvAdapter; opts?: { store?: KeyvAdapter } }
  type KeyvAdapter = { getClient?: () => Promise<{ flushDb: () => Promise<void> }> }
  const stores = (cache as unknown as { stores: KeyvStore[] }).stores
  for (const keyv of stores) {
    const adapter = keyv._store ?? keyv.opts?.store
    if (adapter && typeof adapter.getClient === 'function') {
      const client = await adapter.getClient()
      await client.flushDb()
    }
  }

  // Scoped throttler cleanup: delete only `throttle:v1:*` keys (never FLUSHDB).
  if (throttlerStorage) {
    await throttlerStorage.reset()
  }
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
 * Attach an existing user to an existing organization with a specific role,
 * bypassing the HTTP invite/accept flow.
 *
 * Tests that exercise post-membership behaviour (RBAC freshness, role
 * removal, cross-org boundary checks, etc.) used to chain through the
 * legacy `POST /organizations/:orgId/members/invite` endpoint, which
 * created the membership synchronously. After OB-02 Stage C the invite
 * route no longer auto-creates a membership — it issues a pending
 * `OrgInvite` row that is materialized only via `POST /auth/invites/accept`.
 * Going through that flow in setup just to attach a known user to a
 * known org is wasteful and obscures the test intent.
 *
 * This helper writes `OrgMember` + `MemberRole` rows directly and bumps
 * the org's `aclVersion`. It does NOT invalidate any permissions cache —
 * tests that care about cache freshness should warm the cache after
 * calling this helper (see the OA-04/OA-12 regression for the pattern).
 */
export async function seedOrgMember(
  prisma: PrismaService,
  { orgId, userId, roleId }: { orgId: string; userId: string; roleId: string }
): Promise<{ memberId: string }> {
  return prisma.$transaction(async (tx) => {
    const member = await tx.orgMember.create({
      data: { userId, organizationId: orgId },
      select: { id: true },
    })
    await tx.memberRole.create({ data: { memberId: member.id, roleId } })
    await tx.organization.update({
      where: { id: orgId },
      data: { aclVersion: { increment: 1 } },
    })
    return { memberId: member.id }
  })
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

/**
 * Sign an access token with an arbitrary payload using the app's configured
 * JwtService (same secret/expiry as production minting). Used by OB-06b e2e to
 * craft a legacy token WITHOUT a `sid` claim, or a token for a password-less
 * (OAuth-only) user, which the normal login flow cannot produce.
 */
export function signAccessToken(app: INestApplication, payload: Record<string, unknown>): string {
  return app.get(JwtService, { strict: false }).sign(payload)
}
