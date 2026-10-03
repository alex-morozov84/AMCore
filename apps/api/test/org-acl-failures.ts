import { createClient } from '@redis/client'

import { OrganizationContextResolver } from '../src/core/auth/organization-context'
import { EnvService } from '../src/env/env.service'
import { Prisma } from '../src/generated/prisma/client'
import { MetricsService } from '../src/infrastructure/observability'
import { PrismaService } from '../src/prisma'

import { noopPinoLogger } from './helpers'
import type { AclFixture } from './org-acl-freshness.fixture'

export function aclFailureCases(fixture: () => AclFixture): void {
  it('rolls back both the actual role removal and version bump before commit', async () => {
    const f = fixture()
    await f.member()
    await f.grant()
    await f.assign()
    await f.read().expect(200)
    const old = await f.version()
    const transaction = f.prisma.$transaction.bind(f.prisma)
    let armed = true
    f.prisma.$transaction = (async (
      load: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options: unknown
    ) => {
      return transaction(async (tx) => {
        const update = tx.organization.update.bind(tx.organization)
        tx.organization.update = (async (args: Parameters<typeof update>[0]) => {
          const result = await update(args)
          if (armed && args.where.id === f.org.id) {
            armed = false
            throw new Error('test failure after real ACL write and bump')
          }
          return result
        }) as unknown as typeof update
        return load(tx)
      }, options as never)
    }) as typeof transaction
    try {
      await f.http('delete', `${f.base}/members/${f.target.id}/roles/${f.role.id}`).expect(500)
    } finally {
      f.prisma.$transaction = transaction
    }
    expect(armed).toBe(false)
    expect(await f.version()).toBe(old)
    expect(
      await f.prisma.memberRole.count({
        where: {
          roleId: f.role.id,
          member: { userId: f.target.id, organizationId: f.org.id },
        },
      })
    ).toBe(1)
    await f.read().expect(200)
  })

  it.each([
    [
      'pool',
      new Prisma.PrismaClientKnownRequestError('pool', { code: 'P2024', clientVersion: '7.10.0' }),
      503,
      'DATABASE_POOL_TIMEOUT',
    ],
    [
      'initialization',
      new Prisma.PrismaClientInitializationError('unavailable', '7.10.0'),
      503,
      'PRISMA_INITIALIZATION_ERROR',
    ],
    [
      'unknown',
      new Prisma.PrismaClientUnknownRequestError('transport', { clientVersion: '7.10.0' }),
      503,
      'PRISMA_UNKNOWN_REQUEST_ERROR',
    ],
    ['generic', new Error('unexpected'), 500, 'INTERNAL_SERVER_ERROR'],
  ])(
    'preserves %s failure mapping without cached authority',
    async (_name, error, status, code) => {
      const f = fixture()
      await f.member()
      await f.grant()
      await f.assign()
      await f.read().expect(200)
      const read = f.prisma.orgMember.findUnique.bind(f.prisma.orgMember)
      f.prisma.orgMember.findUnique = (async () => {
        throw error
      }) as unknown as typeof read
      try {
        const res = await f
          .read()
          .timeout(2000)
          .expect(status as number)
        expect(res.body.errorCode).toBe(code)
        if (code === 'DATABASE_POOL_TIMEOUT') expect(res.headers['retry-after']).toBe('1')
      } finally {
        f.prisma.orgMember.findUnique = read
      }
    }
  )

  it('fails closed on a real unavailable primary connection with warm permission cache', async () => {
    const f = fixture()
    await f.member()
    await f.grant()
    await f.assign()
    await f.read().expect(200)
    const env = f.app.get(EnvService)
    const get = env.get.bind(env)
    const isolated = {
      get: (name: Parameters<typeof get>[0]) => {
        if (name === 'DATABASE_URL') return 'postgresql://test:test@127.0.0.1:1/absent'
        if (name === 'DATABASE_CONNECT_MS' || name === 'DATABASE_QUERY_TIMEOUT_MS') return 100
        return get(name)
      },
    } as EnvService
    const db = new PrismaService(isolated, noopPinoLogger, f.app.get(MetricsService))
    const owner = f.app.get(OrganizationContextResolver) as unknown as { prisma: PrismaService }
    const primary = owner.prisma
    owner.prisma = db
    try {
      const res = await f.read().timeout(2000)
      expect([500, 503]).toContain(res.status)
      expect(res.body.errorCode).toMatch(/PRISMA_/)
    } finally {
      owner.prisma = primary
      await db.onModuleDestroy()
    }
  })

  it.each(['lock', 'set'])(
    'propagates actual closed-Redis %s failure before a handler runs',
    async (stage) => {
      const f = fixture()
      await f.member()
      await f.grant()
      await f.assign()
      const dead = createClient({ disableOfflineQueue: true })
      const set = f.redis.set.bind(f.redis)
      Object.assign(f.redis, {
        set: ((...args: Parameters<typeof set>) => {
          const key = args[0] as string
          const affected =
            stage === 'lock'
              ? key === `auth:lock:perm:v2:${f.org.id}:${f.target.id}`
              : key.startsWith(`auth:perm:v2:${f.org.id}:${f.target.id}:`)
          return affected ? Reflect.apply(dead.set, dead, args) : set(...args)
        }) as typeof set,
      })
      try {
        await f.read().timeout(2000).expect(500)
      } finally {
        Object.assign(f.redis, { set })
      }
      await f.read().expect(200)
    }
  )

  it('fails closed with an actual closed Redis client, without indefinite offline queuing', async () => {
    const f = fixture()
    await f.member()
    await f.grant()
    await f.assign()
    await f.read().expect(200)
    const dead = createClient({ disableOfflineQueue: true })
    const owner = f.permissions as unknown as { redis: typeof f.redis }
    const shared = owner.redis
    owner.redis = dead as unknown as typeof f.redis
    try {
      await f.read().timeout(2000).expect(500)
    } finally {
      owner.redis = shared
    }
    await f.read().expect(200)
  })
}
