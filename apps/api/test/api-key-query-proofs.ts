import { Client } from 'pg'

import { type AdminApiKeyListResponse, adminApiKeyQuerySchema } from '@amcore/shared'

import { AdminApiKeysService } from '../src/core/admin/admin-api-keys.service'
import type { AuditLogService } from '../src/core/audit'
import type { PrismaService } from '../src/prisma'

/** Insert a real statement barrier between the service's page and count queries. */
export async function proveInventorySnapshot(
  prisma: PrismaService,
  audit: AuditLogService,
  databaseUrl: string,
  ownerId: string,
  organizationId: string,
  actorId: string
): Promise<AdminApiKeyListResponse> {
  const blocker = new Client({ connectionString: databaseUrl })
  await blocker.connect()
  const lock = 20020
  await blocker.query('SELECT pg_advisory_lock($1)', [lock])
  const transaction = prisma.$transaction.bind(prisma)
  const observed = { apiKey: prisma.apiKey } as PrismaService
  observed.$transaction = (async (queries: unknown[], options: unknown) => {
    expect(options).toEqual({ isolationLevel: 'RepeatableRead' })
    const expanded = [
      queries[0],
      prisma.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${lock})::text`),
      queries[1],
    ]
    const [page, , count] = await transaction(expanded as never, options as never)
    return [page, count]
  }) as typeof prisma.$transaction
  const service = new AdminApiKeysService(observed, audit)
  let pending: ReturnType<typeof service.list> | undefined
  try {
    pending = service.list(adminApiKeyQuerySchema.parse({ userId: ownerId }), actorId)
    let blocked = false
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await blocker.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event = 'advisory' AND query LIKE 'SELECT pg_advisory_xact_lock%'"
      )
      if (result.rows[0].n === 1) {
        blocked = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(blocked).toBe(true)
    await prisma.apiKey.create({
      data: {
        name: 'Concurrent snapshot insertion',
        userId: ownerId,
        organizationId,
        shortToken: 'snapshot-fixture',
        keyHash: 'fake-verifier',
        salt: 'fake-salt',
        scopes: ['read:User'],
      },
    })
    await blocker.query('SELECT pg_advisory_unlock($1)', [lock])
    const result = await pending
    expect(await prisma.apiKey.count({ where: { userId: ownerId } })).toBe(2)
    return result
  } finally {
    await blocker.query('SELECT pg_advisory_unlock($1)', [lock])
    if (pending) await pending.catch(() => undefined)
    await blocker.end()
  }
}
