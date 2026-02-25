import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

describe('API Keys (e2e)', () => {
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

  async function createApiKey(token: string, name = 'Test Key', scopes = ['user:read']) {
    const res = await request(app.getHttpServer())
      .post('/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, scopes })
      .expect(201)
    return res.body as { id: string; key: string; name: string; scopes: string[] }
  }

  describe('POST /api-keys', () => {
    it('creates key and returns full key value once', async () => {
      const { token } = await registerAndGetToken('user@example.com')

      const res = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'My Integration', scopes: ['workout:read'] })
        .expect(201)

      expect(res.body.id).toBeDefined()
      expect(res.body.key).toMatch(/^amcore_live_/)
      expect(res.body.name).toBe('My Integration')
      expect(res.body.scopes).toEqual(['workout:read'])
      expect(res.body).not.toHaveProperty('keyHash')
      expect(res.body).not.toHaveProperty('salt')
    })

    it('returns 401 without auth', async () => {
      await request(app.getHttpServer())
        .post('/api-keys')
        .send({ name: 'Key', scopes: ['user:read'] })
        .expect(401)
    })
  })

  describe('GET /api-keys', () => {
    it('lists keys without secret fields', async () => {
      const { token } = await registerAndGetToken('user@example.com')
      await createApiKey(token, 'Key One', ['workout:read'])
      await createApiKey(token, 'Key Two', ['user:read'])

      const res = await request(app.getHttpServer())
        .get('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)

      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body).toHaveLength(2)
      expect(res.body[0]).not.toHaveProperty('key')
      expect(res.body[0]).not.toHaveProperty('keyHash')
      expect(res.body[0]).not.toHaveProperty('salt')
      expect(res.body[0]).toHaveProperty('id')
      expect(res.body[0]).toHaveProperty('name')
      expect(res.body[0]).toHaveProperty('scopes')
    })
  })

  describe('DELETE /api-keys/:id', () => {
    it('revokes own key and returns 204', async () => {
      const { token } = await registerAndGetToken('user@example.com')
      const { id } = await createApiKey(token)

      await request(app.getHttpServer())
        .delete(`/api-keys/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204)
    })

    it("returns 404 for another user's key", async () => {
      const { token: token1 } = await registerAndGetToken('user1@example.com')
      const { token: token2 } = await registerAndGetToken('user2@example.com')
      const { id } = await createApiKey(token1)

      await request(app.getHttpServer())
        .delete(`/api-keys/${id}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(404)
    })
  })

  describe('using api key for authentication', () => {
    it('authenticates GET /auth/me with valid api key', async () => {
      const { token } = await registerAndGetToken('user@example.com')
      const { key } = await createApiKey(token, 'CI Key', ['user:read'])

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${key}`)
        .expect(200)

      expect(res.body.user).toBeDefined()
      expect(res.body.user.email).toBe('user@example.com')
    })

    it('returns 401 after key is revoked', async () => {
      const { token } = await registerAndGetToken('user@example.com')
      const { key, id } = await createApiKey(token, 'Temp Key', ['user:read'])

      await request(app.getHttpServer())
        .delete(`/api-keys/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204)

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${key}`)
        .expect(401)
    })
  })
})
