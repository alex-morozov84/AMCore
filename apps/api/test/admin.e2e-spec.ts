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
  })

  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache)
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
})
