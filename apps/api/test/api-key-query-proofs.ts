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

export async function explainInventoryQueries(
  prisma: PrismaService,
  ownerId: string,
  organizationId: string
): Promise<Record<string, unknown>> {
  await prisma.$executeRawUnsafe(`INSERT INTO core.users (id,email,"emailCanonical","updatedAt")
    SELECT 'c'||substr(md5('query-owner-'||i),1,24), 'query-fixture-'||i||'@example.test', 'query-fixture-'||i||'@example.test', now() FROM generate_series(1,99) i`)
  await prisma.$executeRawUnsafe(`INSERT INTO core.organizations (id,name,slug,"updatedAt")
    SELECT 'c'||substr(md5('query-org-'||i),1,24), 'Query org '||i, 'query-org-'||i, now() FROM generate_series(1,99) i`)
  await prisma.$executeRawUnsafe(
    `INSERT INTO core.api_keys (id,name,"shortToken","keyHash",salt,scopes,"userId","organizationId","createdAt","expiresAt","revokedAt","revokedByUserId","revocationReason")
    SELECT 'c'||substr(md5('query-fixture-'||i),1,24), 'Query fixture '||i, 'query-fixture-'||i,
    CASE WHEN i%11=0 THEN NULL ELSE 'fake-verifier' END,
    CASE WHEN i%11=0 THEN NULL ELSE 'fake-salt' END,
    ARRAY['read:User'],
    CASE WHEN i%100=0 THEN $1 ELSE 'c'||substr(md5('query-owner-'||(i%100)),1,24) END,
    CASE WHEN i%100=0 THEN $2 ELSE 'c'||substr(md5('query-org-'||(i%100)),1,24) END,
    now()-(i*interval '1 minute'), CASE WHEN i%10=0 THEN now()-interval '1 day' ELSE NULL END,
    CASE WHEN i%11=0 THEN now()-interval '1 hour' ELSE NULL END,
    CASE WHEN i%11=0 THEN $1 ELSE NULL END,
    CASE WHEN i%11=0 THEN 'owner_revoked' ELSE NULL END
    FROM generate_series(1,10000) i`,
    ownerId,
    organizationId
  )
  await prisma.$executeRawUnsafe('ANALYZE core.api_keys')
  const queries = {
    defaultPage: 'SELECT id,name FROM core.api_keys ORDER BY "createdAt" DESC,id DESC LIMIT 20',
    revoked:
      'SELECT id,name FROM core.api_keys WHERE "revokedAt" IS NOT NULL ORDER BY "createdAt" DESC,id DESC LIMIT 20',
    literalSearch: "SELECT count(*) FROM core.api_keys WHERE name ILIKE '%fixture 999%'",
    identityNullableSort:
      'SELECT id,name FROM core.api_keys WHERE "userId"=$1 AND "organizationId"=$2 ORDER BY "lastUsedAt" DESC NULLS LAST,id DESC LIMIT 20',
  }
  const evidence: Record<string, unknown> = {}
  for (const [name, query] of Object.entries(queries)) {
    const params = name === 'identityNullableSort' ? [ownerId, organizationId] : []
    const [result] = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': unknown }>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
      ...params
    )
    evidence[name] = result!['QUERY PLAN']
  }
  return evidence
}
