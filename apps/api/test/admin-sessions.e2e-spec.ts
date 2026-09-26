import { fileURLToPath } from 'node:url'

import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { resolveTrustedWebPeers } from '../src/common/utils/trusted-web-peer'
import { AuditLogService } from '../src/core/audit'
import { sessionCoordinationLockKey } from '../src/core/auth/session-lock-key'
import { EnvService } from '../src/env/env.service'
import { GeoIpService } from '../src/infrastructure/geoip/geoip.service'
import { acquireXactLock, type PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

describe('Admin sessions (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  const PASSWORD = 'StrongP@ss123'

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })

  async function registerAndGetToken(email: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201)
    return {
      token: res.body.accessToken as string,
      userId: res.body.user.id as string,
      cookie: res.headers['set-cookie'] as unknown as string[],
    }
  }

  async function makeSuperAdmin(email: string) {
    const reg = await registerAndGetToken(email)
    await prisma.user.update({ where: { id: reg.userId }, data: { systemRole: 'SUPER_ADMIN' } })
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200)
    return {
      userId: reg.userId,
      token: login.body.accessToken as string,
      cookie: login.headers['set-cookie'] as unknown as string[],
    }
  }

  async function ageSessions(userId: string) {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { lastAuthAt: new Date(Date.now() - 60 * 60 * 1000) },
    })
  }

  describe('Session metadata and locale (real HTTP/storage/reader)', () => {
    it('register/login/rotation capture verified metadata; both list projections negotiate locale', async () => {
      const env = app.get(EnvService),
        original = env.get.bind(env)
      env.get = (key) => {
        if (key === 'TRUSTED_WEB_PEERS') return resolveTrustedWebPeers('loopback') as never
        if (key === 'GEOIP_DB_PATH')
          return fileURLToPath(
            new URL('./fixtures/geoip/GeoIP2-City-Test.mmdb', import.meta.url)
          ) as never
        return original(key)
      }
      try {
        await app.get(GeoIpService).reload()
        const admin = await makeSuperAdmin('sa-metadata@example.com')
        const email = 'target-metadata@example.com'
        const register = await request(app.getHttpServer())
          .post('/auth/register')
          .set('User-Agent', 'Registration browser')
          .set('X-AMCore-Client-Ip', '81.2.69.142')
          .send({ email, password: PASSWORD })
          .expect(201)
        const userId = register.body.user.id as string
        expect(await prisma.session.findFirst({ where: { userId } })).toMatchObject({
          ipAddress: '81.2.69.142',
          userAgent: 'Registration browser',
        })
        const login = await request(app.getHttpServer())
          .post('/auth/login')
          .set('User-Agent', 'Login browser')
          .set('X-AMCore-Client-Ip', '81.2.69.142')
          .send({ email, password: PASSWORD })
          .expect(200)
        const previous = await prisma.session.findFirstOrThrow({
          where: { userId, userAgent: 'Login browser' },
        })
        const refresh = await request(app.getHttpServer())
          .post('/auth/refresh')
          .set('Cookie', login.headers['set-cookie'] as unknown as string[])
          .set('User-Agent', 'Current rotation browser')
          .set('X-AMCore-Client-Ip', '::ffff:81.2.69.142')
          .expect(200)
        const rotated = await prisma.session.findFirstOrThrow({
          where: { familyId: previous.familyId, revokedAt: null },
        })
        expect(rotated).toMatchObject({
          ipAddress: '::ffff:81.2.69.142',
          userAgent: 'Current rotation browser',
          lastAuthAt: previous.lastAuthAt,
        })
        expect(rotated.id).not.toBe(previous.id)
        for (const [header, city] of [
          ['ru', 'Лондон'],
          ['en', 'London'],
          ['xx', 'London'],
          ['@@', 'London'],
          ['', 'London'],
        ]) {
          const adminList = await request(app.getHttpServer())
            .get(`/admin/users/${userId}/sessions`)
            .set('Authorization', `Bearer ${admin.token}`)
            .set('Accept-Language', header!)
            .expect(200)
          const ownList = await request(app.getHttpServer())
            .get('/auth/sessions')
            .set('Authorization', `Bearer ${refresh.body.accessToken}`)
            .set('Cookie', refresh.headers['set-cookie'] as unknown as string[])
            .set('Accept-Language', header!)
            .expect(200)
          expect(
            adminList.body.data.every(
              (row: { location: { city: string } }) => row.location.city === city
            )
          ).toBe(true)
          expect(
            ownList.body.data.every(
              (row: { location: { city: string } }) => row.location.city === city
            )
          ).toBe(true)
        }
      } finally {
        env.get = original
      }
    })

    it('disabled/untrusted claims retain direct socket metadata and missing UA becomes null', async () => {
      const target = await request(app.getHttpServer())
        .post('/auth/register')
        .set('X-AMCore-Client-Ip', '81.2.69.142')
        .send({ email: 'fallback-metadata@example.com', password: PASSWORD })
        .expect(201)
      const row = await prisma.session.findFirstOrThrow({ where: { userId: target.body.user.id } })
      expect(row.userAgent).toBeNull()
      expect(row.ipAddress).not.toBe('81.2.69.142')
      expect(app.get(GeoIpService).resolve(row.ipAddress, 'en')).toBeNull()
    })
  })

  describe('access control', () => {
    it('401 without a token on every route', async () => {
      const { userId } = await registerAndGetToken('u1@example.com')
      await request(app.getHttpServer()).get(`/admin/users/${userId}/sessions`).expect(401)
      await request(app.getHttpServer())
        .delete(`/admin/users/${userId}/sessions/${'a'.repeat(32)}`)
        .expect(401)
      await request(app.getHttpServer()).delete(`/admin/users/${userId}/sessions`).expect(401)
    })

    it('403 for a regular USER', async () => {
      const { token } = await registerAndGetToken('u2@example.com')
      const { userId: targetId } = await registerAndGetToken('target1@example.com')

      await request(app.getHttpServer())
        .get(`/admin/users/${targetId}/sessions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403)
    })
  })

  describe('mutation admission', () => {
    it('regular USER and SUPER_ADMIN-owned API key cannot use any Session route', async () => {
      const user = await registerAndGetToken('denied-user@example.com')
      const admin = await makeSuperAdmin('denied-key-owner@example.com')
      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Session key denial fixture' })
        .expect(201)
      const key = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Session denial key', organizationId: org.body.id, scopes: ['read:User'] })
        .expect(201)
      for (const [token, status] of [
        [user.token, 403],
        [key.body.key, 401],
      ] as const) {
        const base = `/admin/users/${user.userId}/sessions`
        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', `Bearer ${token}`)
          .expect(status)
        await request(app.getHttpServer())
          .delete(base)
          .set('Authorization', `Bearer ${token}`)
          .expect(status)
        await request(app.getHttpServer())
          .delete(`${base}/${'a'.repeat(32)}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(status)
      }
    })

    it('revoked actor generation fails both mutation freshness guards without changing target', async () => {
      const admin = await makeSuperAdmin('revoked-actor@example.com')
      const target = await registerAndGetToken('revoked-actor-target@example.com')
      const session = await prisma.session.findFirstOrThrow({ where: { userId: target.userId } })
      await prisma.session.updateMany({
        where: { userId: admin.userId },
        data: { revokedAt: new Date() },
      })
      for (const path of ['', `/${session.familyId}`]) {
        const res = await request(app.getHttpServer())
          .delete(`/admin/users/${target.userId}/sessions${path}`)
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(403)
        expect(res.body.errorCode).toBe('STEP_UP_REQUIRED')
      }
      expect(
        (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt
      ).toBeNull()
    })
  })

  describe('GET /admin/users/:id/sessions', () => {
    it('404 for a nonexistent user', async () => {
      const admin = await makeSuperAdmin('sa-list-404@example.com')

      await request(app.getHttpServer())
        .get('/admin/users/00000000-0000-4000-8000-000000000000/sessions')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(404)
    })

    it('returns the target user’s active sessions with the opaque family identity, not the token hash or revokedAt', async () => {
      const admin = await makeSuperAdmin('sa-list-ok@example.com')
      const target = await registerAndGetToken('target-list-ok@example.com')

      const res = await request(app.getHttpServer())
        .get(`/admin/users/${target.userId}/sessions`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200)

      expect(res.body.total).toBe(1)
      const row = res.body.data[0]
      expect(row.sessionId).toMatch(/^[0-9a-f]{32}$/)
      expect(row).not.toHaveProperty('revokedAt')
      expect(row).not.toHaveProperty('refreshToken')
      expect(row.location).toBeNull() // no GeoIP database loaded in the test environment
      expect(typeof row.createdAt).toBe('string')
      expect(typeof row.expiresAt).toBe('string')
    })

    it('distinguishes an empty result from a not-found user', async () => {
      const admin = await makeSuperAdmin('sa-list-empty@example.com')
      const target = await registerAndGetToken('target-list-empty@example.com')
      await prisma.session.updateMany({
        where: { userId: target.userId },
        data: { revokedAt: new Date() },
      })

      const res = await request(app.getHttpServer())
        .get(`/admin/users/${target.userId}/sessions`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200)

      expect(res.body.data).toEqual([])
      expect(res.body.total).toBe(0)
    })

    it('audits the successful read, hidden from the default Audit browse', async () => {
      const admin = await makeSuperAdmin('sa-list-audit@example.com')
      const target = await registerAndGetToken('target-list-audit@example.com')

      await request(app.getHttpServer())
        .get(`/admin/users/${target.userId}/sessions`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200)

      const events = await prisma.auditLog.findMany({
        where: { action: 'admin.user.sessions_viewed', targetId: target.userId },
      })
      expect(events).toHaveLength(1)

      const browse = await request(app.getHttpServer())
        .get('/admin/audit-logs')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200)
      expect(
        browse.body.items.some((e: { action: string }) => e.action === 'admin.user.sessions_viewed')
      ).toBe(false)
    })
  })

  describe('DELETE /admin/users/:id/sessions/:sessionId', () => {
    it('404 when the family is absent or belongs to another user', async () => {
      const admin = await makeSuperAdmin('sa-revoke-404@example.com')
      const target = await registerAndGetToken('target-revoke-404@example.com')

      await request(app.getHttpServer())
        .delete(`/admin/users/${target.userId}/sessions/${'a'.repeat(32)}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(404)
    })

    it('soft-revokes the session (row survives with revokedAt set) and is idempotent on repeat', async () => {
      const admin = await makeSuperAdmin('sa-revoke-ok@example.com')
      const target = await registerAndGetToken('target-revoke-ok@example.com')
      const session = await prisma.session.findFirstOrThrow({ where: { userId: target.userId } })

      await request(app.getHttpServer())
        .delete(`/admin/users/${target.userId}/sessions/${session.familyId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204)

      const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } })
      expect(row.revokedAt).not.toBeNull()
      expect(row.revocationReason).toBe('admin_revoked')

      // Repeat: the family still exists (now inactive) — idempotent 204, not 404.
      await request(app.getHttpServer())
        .delete(`/admin/users/${target.userId}/sessions/${session.familyId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204)
    })

    it('400 when an admin targets their own session through this action', async () => {
      const admin = await makeSuperAdmin('sa-revoke-self@example.com')
      const own = await prisma.session.findFirstOrThrow({ where: { userId: admin.userId } })

      await request(app.getHttpServer())
        .delete(`/admin/users/${admin.userId}/sessions/${own.familyId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(400)
    })

    it('requires step-up freshness (OB-06b)', async () => {
      const admin = await makeSuperAdmin('sa-revoke-stepup@example.com')
      const target = await registerAndGetToken('target-revoke-stepup@example.com')
      const session = await prisma.session.findFirstOrThrow({ where: { userId: target.userId } })
      await ageSessions(admin.userId)

      const stale = await request(app.getHttpServer())
        .delete(`/admin/users/${target.userId}/sessions/${session.familyId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(403)
      expect(stale.body.errorCode).toBe('STEP_UP_REQUIRED')

      await request(app.getHttpServer())
        .post('/auth/step-up')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ password: PASSWORD })
        .expect(200)

      await request(app.getHttpServer())
        .delete(`/admin/users/${target.userId}/sessions/${session.familyId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204)
    })
  })

  describe('DELETE /admin/users/:id/sessions', () => {
    it('204 even with zero active sessions, and audits the actual (zero) count', async () => {
      const admin = await makeSuperAdmin('sa-revoke-all-zero@example.com')
      const target = await registerAndGetToken('target-revoke-all-zero@example.com')
      await prisma.session.updateMany({
        where: { userId: target.userId },
        data: { revokedAt: new Date() },
      })

      await request(app.getHttpServer())
        .delete(`/admin/users/${target.userId}/sessions`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204)

      const event = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.user.sessions_revoked', targetId: target.userId },
      })
      expect((event.metadata as { count: number }).count).toBe(0)
    })

    it('soft-revokes every active session for the user', async () => {
      const admin = await makeSuperAdmin('sa-revoke-all-ok@example.com')
      const target = await registerAndGetToken('target-revoke-all-ok@example.com')
      // A second login creates a second active session (different family).
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'target-revoke-all-ok@example.com', password: PASSWORD })
        .expect(200)
      expect(
        await prisma.session.count({ where: { userId: target.userId, revokedAt: null } })
      ).toBe(2)

      await request(app.getHttpServer())
        .delete(`/admin/users/${target.userId}/sessions`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204)

      expect(
        await prisma.session.count({ where: { userId: target.userId, revokedAt: null } })
      ).toBe(0)
    })

    it('400 when an admin targets their own sessions through this action', async () => {
      const admin = await makeSuperAdmin('sa-revoke-all-self@example.com')

      await request(app.getHttpServer())
        .delete(`/admin/users/${admin.userId}/sessions`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(400)
    })
  })

  describe('snapshot and transactional proof', () => {
    it('deduplicates before pagination, retains total on an empty page and emits UTC timestamps', async () => {
      const admin = await makeSuperAdmin('sa-dedup@example.com')
      const target = await registerAndGetToken('target-dedup@example.com')
      const original = await prisma.session.findFirstOrThrow({ where: { userId: target.userId } })
      await prisma.session.create({
        data: {
          userId: target.userId,
          familyId: original.familyId,
          refreshToken: 'fixture-duplicate-hash',
          createdAt: new Date('2030-01-01T01:02:03Z'),
          expiresAt: new Date('2031-01-01T01:02:03Z'),
          userAgent: 'latest-generation',
          lastAuthAt: new Date('2026-01-02T03:04:05Z'),
        },
      })
      const get = (page: number) =>
        request(app.getHttpServer())
          .get(`/admin/users/${target.userId}/sessions?page=${page}&limit=1`)
          .set('Authorization', `Bearer ${admin.token}`)
      const first = await get(1).expect(200),
        empty = await get(2).expect(200)
      expect(first.body.total).toBe(1)
      expect(first.body.data[0].userAgent).toBe('latest-generation')
      expect(first.body.data[0].createdAt).toBe('2030-01-01T01:02:03.000Z')
      expect(empty.body).toMatchObject({ total: 1, data: [] })
      await request(app.getHttpServer())
        .delete(`/admin/users/${target.userId}/sessions`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204)
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'admin.user.sessions_revoked', targetId: target.userId },
      })
      expect(audit.metadata).toMatchObject({ count: 1 })
    })

    it.each(['one', 'all'])(
      'audit failure rolls back revoke %s in the actual transaction',
      async (kind) => {
        const admin = await makeSuperAdmin(`sa-rollback-${kind}@example.com`)
        const target = await registerAndGetToken(`target-rollback-${kind}@example.com`)
        const session = await prisma.session.findFirstOrThrow({ where: { userId: target.userId } })
        const audit = app.get(AuditLogService),
          record = audit.record
        audit.record = async () => {
          throw new Error('audit unavailable')
        }
        try {
          await request(app.getHttpServer())
            .delete(
              `/admin/users/${target.userId}/sessions${kind === 'one' ? `/${session.familyId}` : ''}`
            )
            .set('Authorization', `Bearer ${admin.token}`)
            .expect(500)
        } finally {
          audit.record = record
        }
        expect(
          (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt
        ).toBeNull()
        expect(
          await prisma.auditLog.count({
            where: {
              targetId: target.userId,
              action: { in: ['admin.user.session_revoked', 'admin.user.sessions_revoked'] },
            },
          })
        ).toBe(0)
      }
    )

    it('expired rows are a no-op and a foreign family is not found', async () => {
      const admin = await makeSuperAdmin('sa-expire@example.com')
      const target = await registerAndGetToken('target-expire@example.com')
      const foreign = await prisma.session.findFirstOrThrow({ where: { userId: admin.userId } })
      await request(app.getHttpServer())
        .delete(`/admin/users/${target.userId}/sessions/${foreign.familyId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(404)
      await prisma.session.updateMany({
        where: { userId: target.userId },
        data: { expiresAt: new Date(0) },
      })
      await request(app.getHttpServer())
        .delete(`/admin/users/${target.userId}/sessions`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(204)
      const event = await prisma.auditLog.findFirstOrThrow({
        where: { targetId: target.userId, action: 'admin.user.sessions_revoked' },
      })
      expect(event.metadata).toMatchObject({ count: 0 })
    })
  })

  /**
   * Real-Postgres proof that the shared advisory lock
   * (`sessionCoordinationLockKey`) actually serializes admin session
   * mutations against each other and against `rotateRefreshToken`, rather
   * than merely looking correct under sequential test execution.
   */
  describe('concurrency (real Postgres advisory lock)', () => {
    it('two concurrent revoke-all calls never double-count the same session', async () => {
      const admin = await makeSuperAdmin('sa-race-revoke-all@example.com')
      const target = await registerAndGetToken('target-race-revoke-all@example.com')
      for (let i = 0; i < 2; i += 1) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: 'target-race-revoke-all@example.com', password: PASSWORD })
          .expect(200)
      }
      const activeBefore = await prisma.session.count({
        where: { userId: target.userId, revokedAt: null },
      })
      expect(activeBefore).toBe(3)

      const del = () =>
        request(app.getHttpServer())
          .delete(`/admin/users/${target.userId}/sessions`)
          .set('Authorization', `Bearer ${admin.token}`)
          .expect(204)
      await Promise.all([del(), del()])

      const events = await prisma.auditLog.findMany({
        where: { action: 'admin.user.sessions_revoked', targetId: target.userId },
        orderBy: { createdAt: 'asc' },
      })
      const totalReported = events.reduce(
        (sum, e) => sum + (e.metadata as { count: number }).count,
        0
      )
      expect(totalReported).toBe(activeBefore)
      expect(
        await prisma.session.count({ where: { userId: target.userId, revokedAt: null } })
      ).toBe(0)
    })

    it.each(['refresh-first', 'revoke-first'])(
      'forces %s through the real Postgres lock queue',
      async (order) => {
        const admin = await makeSuperAdmin(`sa-${order}@example.com`)
        const target = await registerAndGetToken(`target-${order}@example.com`)
        const session = await prisma.session.findFirstOrThrow({ where: { userId: target.userId } })
        const key = sessionCoordinationLockKey(target.userId)
        let release!: () => void, held!: () => void
        const barrier = new Promise<void>((resolve) => {
          release = resolve
        })
        const acquired = new Promise<void>((resolve) => {
          held = resolve
        })
        const holder = prisma.$transaction(
          async (tx) => {
            await acquireXactLock(tx, key)
            held()
            await barrier
          },
          { timeout: 15000 }
        )
        await acquired
        const refresh = () =>
          request(app.getHttpServer())
            .post('/auth/refresh')
            .set('Cookie', target.cookie)
            .then((response) => response)
        const revoke = () =>
          request(app.getHttpServer())
            .delete(`/admin/users/${target.userId}/sessions/${session.familyId}`)
            .set('Authorization', `Bearer ${admin.token}`)
            .then((response) => response)
        async function waitForQueue(count: number) {
          const deadline = Date.now() + 10000
          while (Date.now() < deadline) {
            const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
            SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
              AND classid = ((hashtextextended(${key}, 0) >> 32) & 4294967295)::oid
              AND objid = (hashtextextended(${key}, 0) & 4294967295)::oid
              AND objsubid = 1
          `
            if (row?.count === count) return
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          throw new Error(`Expected ${count} actual advisory-lock waiters`)
        }
        let first: ReturnType<typeof refresh> | undefined,
          second: ReturnType<typeof refresh> | undefined
        try {
          first = order === 'refresh-first' ? refresh() : revoke()
          await waitForQueue(1)
          second = order === 'refresh-first' ? revoke() : refresh()
          await waitForQueue(2)
        } finally {
          release()
          await holder
        }
        const [one, two] = await Promise.all([first!, second!])
        expect(one.status).toBe(order === 'refresh-first' ? 200 : 204)
        expect(two.status).toBe(order === 'refresh-first' ? 204 : 401)
        expect(
          await prisma.session.count({ where: { familyId: session.familyId, revokedAt: null } })
        ).toBe(0)
        const rows = await prisma.session.findMany({ where: { familyId: session.familyId } })
        expect(rows).toHaveLength(order === 'refresh-first' ? 2 : 1)
        if (order === 'refresh-first') {
          await request(app.getHttpServer())
            .post('/auth/refresh')
            .set('Cookie', one.headers['set-cookie'] as unknown as string[])
            .expect(401)
        }
      }
    )
  })
})
