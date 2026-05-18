import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { SystemRole } from '@amcore/shared'

import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

describe('Admin (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext

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

  async function registerAndGetToken(email: string, password = 'StrongP@ss123') {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)
    return { token: res.body.accessToken as string, userId: res.body.user.id as string }
  }

  async function promoteToSuperAdmin(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { systemRole: 'SUPER_ADMIN' },
    })
    // Login again to get a fresh token with updated role from DB
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'superadmin@example.com', password: 'StrongP@ss123' })
      .expect(200)
    return res.body.accessToken as string
  }

  describe('access control', () => {
    it('returns 401 without token', async () => {
      await request(app.getHttpServer()).get('/admin/users').expect(401)
    })

    it('returns 403 for regular USER', async () => {
      const { token } = await registerAndGetToken('user@example.com')

      await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(403)
    })
  })

  describe('GET /admin/users', () => {
    it('returns paginated user list for SUPER_ADMIN', async () => {
      const { userId } = await registerAndGetToken('superadmin@example.com')
      await registerAndGetToken('other@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)

      expect(res.body.total).toBeGreaterThanOrEqual(2)
      expect(Array.isArray(res.body.data)).toBe(true)
    })
  })

  /**
   * OA-07: admin responses must not expose `passwordHash` (argon2 hash)
   * or `emailCanonical` (internal normalization). `ZodSerializerDto`
   * strips anything outside `adminUserResponseSchema` at the transport
   * layer; the Prisma `select` allowlist prevents the DB from reading
   * those columns in the first place. Both must hold.
   */
  describe('OA-07: admin user responses exclude passwordHash', () => {
    it('GET /admin/users → 200 with no passwordHash and no emailCanonical', async () => {
      const { userId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)

      expect(res.body.data.length).toBeGreaterThan(0)
      for (const user of res.body.data) {
        expect(user).not.toHaveProperty('passwordHash')
        expect(user).not.toHaveProperty('emailCanonical')
        expect(typeof user.createdAt).toBe('string')
        expect(typeof user.updatedAt).toBe('string')
        expect(user.systemRole).toBeDefined()
      }
    })

    it('PATCH /admin/users/:id → 200 with no passwordHash and no emailCanonical', async () => {
      const { userId: targetId } = await registerAndGetToken('target@example.com')
      const { userId: adminId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(adminId)

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${targetId}`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ systemRole: SystemRole.SuperAdmin })
        .expect(200)

      expect(res.body).not.toHaveProperty('passwordHash')
      expect(res.body).not.toHaveProperty('emailCanonical')
      expect(res.body.systemRole).toBe(SystemRole.SuperAdmin)
      expect(typeof res.body.createdAt).toBe('string')
      expect(typeof res.body.updatedAt).toBe('string')
    })
  })

  /**
   * OA-08: admin list endpoints validate `page`/`limit` via Zod and
   * return the paginated envelope `{ data, total, page, limit }`.
   * Invalid input maps to a clean field-level 400, not a Prisma
   * 500 (the old behavior). Organization list also enforces the
   * Prisma `select` allowlist — `aclVersion` (ADR-035 internal RBAC
   * counter) never appears on the wire.
   */
  describe('OA-08: pagination validation', () => {
    it('GET /admin/users without query returns defaults page=1 limit=20', async () => {
      const { userId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)

      expect(res.body.page).toBe(1)
      expect(res.body.limit).toBe(20)
      expect(typeof res.body.total).toBe('number')
    })

    it('GET /admin/users with valid pagination respects page+limit', async () => {
      const { userId } = await registerAndGetToken('superadmin@example.com')
      await registerAndGetToken('other-1@example.com')
      await registerAndGetToken('other-2@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      const res = await request(app.getHttpServer())
        .get('/admin/users?page=2&limit=2')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)

      expect(res.body.page).toBe(2)
      expect(res.body.limit).toBe(2)
      expect(res.body.data.length).toBeLessThanOrEqual(2)
    })

    it.each([
      ['?page=abc', 'page=abc'],
      ['?page=0', 'page=0'],
      ['?page=-1', 'page=-1'],
      ['?limit=0', 'limit=0'],
      ['?limit=-5', 'limit=-5'],
      ['?limit=101', 'limit=101'],
      ['?limit=abc', 'limit=abc'],
    ])('GET /admin/users %s → 400', async (qs) => {
      const { userId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      await request(app.getHttpServer())
        .get(`/admin/users${qs}`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(400)
    })

    it('GET /admin/organizations rejects invalid limit with 400', async () => {
      const { userId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      await request(app.getHttpServer())
        .get('/admin/organizations?limit=999')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(400)
    })

    it('GET /admin/organizations returns envelope without aclVersion', async () => {
      const { userId, token: userToken } = await registerAndGetToken('superadmin@example.com')
      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Pagination Test Org' })
        .expect(201)
      const superToken = await promoteToSuperAdmin(userId)

      const res = await request(app.getHttpServer())
        .get('/admin/organizations')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)

      expect(res.body.page).toBe(1)
      expect(res.body.limit).toBe(20)
      expect(res.body.data.length).toBeGreaterThan(0)
      for (const org of res.body.data) {
        expect(org).not.toHaveProperty('aclVersion')
        expect(typeof org.createdAt).toBe('string')
        expect(typeof org.updatedAt).toBe('string')
      }
    })
  })

  describe('PATCH /admin/users/:id', () => {
    it('promotes user to SUPER_ADMIN', async () => {
      const { userId: targetId } = await registerAndGetToken('target@example.com')
      const { userId: adminId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(adminId)

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${targetId}`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ systemRole: SystemRole.SuperAdmin })
        .expect(200)

      expect(res.body.systemRole).toBe(SystemRole.SuperAdmin)
    })

    it('returns 404 for non-existent user', async () => {
      const { userId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      await request(app.getHttpServer())
        .patch('/admin/users/nonexistent-id')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ systemRole: SystemRole.User })
        .expect(404)
    })
  })

  /**
   * OA-09: protect SUPER_ADMIN role transitions.
   *
   * Self-demotion (foot-gun protection) is the only path that the
   * API can reach the last-SA guard through — `SystemRolesGuard`
   * requires the actor to be SUPER_ADMIN, so a non-self demotion
   * always has the actor as another SUPER_ADMIN. The unit test in
   * `admin.service.spec.ts` locks down the in-transaction last-SA
   * guard for the defense-in-depth case; here we cover what users
   * actually see on the wire.
   */
  describe('OA-09: protect SUPER_ADMIN role transitions', () => {
    it('denies self-demotion with 400 + BUSINESS_RULE_VIOLATION', async () => {
      const { userId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${userId}`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ systemRole: SystemRole.User })
        .expect(400)

      expect(res.body.errorCode).toBe('BUSINESS_RULE_VIOLATION')
    })

    it('demotes target SUPER_ADMIN when another SUPER_ADMIN exists', async () => {
      const { userId: targetId } = await registerAndGetToken('peer-sa@example.com')
      await prisma.user.update({
        where: { id: targetId },
        data: { systemRole: 'SUPER_ADMIN' },
      })
      const { userId: actorId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(actorId)

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${targetId}`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ systemRole: SystemRole.User })
        .expect(200)

      expect(res.body.systemRole).toBe(SystemRole.User)
    })

    it('no-op same-role request returns 200 with current role unchanged', async () => {
      const { userId: targetId } = await registerAndGetToken('target-noop@example.com')
      const { userId: actorId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(actorId)

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${targetId}`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ systemRole: SystemRole.User })
        .expect(200)

      expect(res.body.systemRole).toBe(SystemRole.User)
    })
  })

  describe('POST /admin/cleanup', () => {
    it('returns cleanup counts for SUPER_ADMIN', async () => {
      const { userId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      const res = await request(app.getHttpServer())
        .post('/admin/cleanup')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)

      expect(res.body).toMatchObject({
        expiredSessions: expect.any(Number),
        expiredPasswordResetTokens: expect.any(Number),
        expiredEmailVerificationTokens: expect.any(Number),
        expiredApiKeys: expect.any(Number),
      })
    })

    it('returns 403 for regular USER', async () => {
      const { token } = await registerAndGetToken('user@example.com')

      await request(app.getHttpServer())
        .post('/admin/cleanup')
        .set('Authorization', `Bearer ${token}`)
        .expect(403)
    })
  })

  describe('GET /admin/organizations', () => {
    it('returns all organizations for SUPER_ADMIN', async () => {
      const { userId, token: userToken } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      // Create an org as the user (before promoting, doesn't matter)
      await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'Test Org' })

      const res = await request(app.getHttpServer())
        .get('/admin/organizations')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200)

      expect(res.body.total).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(res.body.data)).toBe(true)
    })
  })

  /**
   * OA-02: admin routes are bearer-only.
   *
   * `SystemRolesGuard` only checks `user.systemRole`; it does not look
   * at credential type or scopes. The principal an `ApiKeyGuard` builds
   * inherits `systemRole` from the owning user, so a SUPER_ADMIN-owned
   * API key with a deliberately narrow scope (`read:User`) would pass
   * the system-role check and reach the admin handler without any
   * scope intersection — `/admin/**` has no `@CheckPolicies`, so the
   * CASL ability built from `userPerms ∩ scopes` is not consulted.
   *
   * Class-level `@Auth(AuthType.Bearer)` on `AdminController` closes
   * this: the auth chain skips the API-key branch entirely, and an
   * `amcore_live_...` bearer fails the JWT branch as 401.
   *
   * Coverage strategy: the SUPER_ADMIN-owned key is the actual
   * vulnerability — a USER-owned key would also have been stopped by
   * `SystemRolesGuard`. We assert SUPER_ADMIN denial on every route
   * (each handler must be inside the class-level decorator's reach),
   * plus a USER-owned sanity case on one route to prove the
   * auth-type policy fires first.
   */
  describe('OA-02: api keys cannot reach admin routes', () => {
    /**
     * Promotes the user to SUPER_ADMIN, creates an org owned by them,
     * issues an API key bound to that org with a deliberately narrow
     * scope, and returns the raw key plus the org id. Returns the
     * fresh SUPER_ADMIN JWT so callers can also confirm positive
     * SUPER_ADMIN access on the same routes if needed.
     */
    async function setupSuperAdminWithKey() {
      const { userId } = await registerAndGetToken('superadmin@example.com')
      const superToken = await promoteToSuperAdmin(userId)

      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: 'Admin Org' })
        .expect(201)
      const orgId = orgRes.body.id as string

      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: 'Privileged attacker key', organizationId: orgId, scopes: ['read:User'] })
        .expect(201)
      return { apiKey: keyRes.body.key as string, superToken, userId }
    }

    /**
     * USER-owned API key is also rejected at the auth-type layer.
     * `SystemRolesGuard` would have stopped this credential too, but
     * the denial must surface from the auth chain before any
     * system-role decision so that `@Auth(AuthType.Bearer)` is the
     * single authoritative gate.
     */
    it('USER-owned API key → GET /admin/users → 401', async () => {
      const { token } = await registerAndGetToken('user@example.com')

      const orgRes = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'User Org' })
        .expect(201)

      const keyRes = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Regular key', organizationId: orgRes.body.id, scopes: ['read:User'] })
        .expect(201)

      await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${keyRes.body.key}`)
        .expect(401)
    })

    it('SUPER_ADMIN-owned API key authenticates on /auth/me (sanity)', async () => {
      const { apiKey } = await setupSuperAdminWithKey()

      // Sanity: the key is well-formed and the owner's role does not
      // get rejected elsewhere — every 401 below is the auth-type
      // policy at /admin, not a malformed credential.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(200)
    })

    it('SUPER_ADMIN-owned API key → GET /admin/users → 401', async () => {
      const { apiKey } = await setupSuperAdminWithKey()

      await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401)
    })

    it('SUPER_ADMIN-owned API key → PATCH /admin/users/:id → 401', async () => {
      const { apiKey, userId } = await setupSuperAdminWithKey()

      await request(app.getHttpServer())
        .patch(`/admin/users/${userId}`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ systemRole: SystemRole.User })
        .expect(401)
    })

    it('SUPER_ADMIN-owned API key → POST /admin/cleanup → 401', async () => {
      const { apiKey } = await setupSuperAdminWithKey()

      await request(app.getHttpServer())
        .post('/admin/cleanup')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401)
    })

    it('SUPER_ADMIN-owned API key → GET /admin/organizations → 401', async () => {
      const { apiKey } = await setupSuperAdminWithKey()

      await request(app.getHttpServer())
        .get('/admin/organizations')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401)
    })
  })
})
