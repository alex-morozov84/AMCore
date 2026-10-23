import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import {
  INTEGRATIONS_MAX,
  integrationsResponseSchema,
  probePreparationSchema,
  probeReceiptSchema,
} from '@amcore/shared'

import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

const BASE = '/admin/integrations'
const PASSWORD = 'StrongP@ss123'

describe('Admin integrations (e2e)', () => {
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

  async function register(email: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201)
    return { token: res.body.accessToken as string, userId: res.body.user.id as string }
  }

  async function operator(email: string, verified = true) {
    const { userId } = await register(email)
    await prisma.user.update({
      where: { id: userId },
      data: { systemRole: 'SUPER_ADMIN', emailVerified: verified },
    })
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200)
    return { userId, token: res.body.accessToken as string }
  }

  describe('authorization', () => {
    it('rejects anonymous callers and a regular user on every route', async () => {
      const server = app.getHttpServer()
      await request(server).get(BASE).expect(401)
      await request(server).post(`${BASE}/email/probe/prepare`).expect(401)
      await request(server)
        .post(`${BASE}/email/probe`)
        .send({ attemptId: 'A'.repeat(22) })
        .expect(401)
      await request(server)
        .get(`${BASE}/email/probe/${'A'.repeat(22)}`)
        .expect(401)
      const { token } = await register('integ-user@example.com')
      for (const call of [
        request(server).get(BASE),
        request(server).post(`${BASE}/email/probe/prepare`),
        request(server)
          .post(`${BASE}/email/probe`)
          .send({ attemptId: 'A'.repeat(22) }),
        request(server).get(`${BASE}/email/probe/${'A'.repeat(22)}`),
      ])
        await call.set('Authorization', `Bearer ${token}`).expect(403)
    })

    it('rejects a SUPER_ADMIN-owned API key (bearer-only)', async () => {
      const { token } = await operator('integ-key-admin@example.com')
      const org = await request(app.getHttpServer())
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Integrations Key Org' })
        .expect(201)
      const key = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Attacker key', organizationId: org.body.id, scopes: ['read:User'] })
        .expect(201)
      const bearer = `Bearer ${key.body.key as string}`
      await request(app.getHttpServer()).get(BASE).set('Authorization', bearer).expect(401)
      await request(app.getHttpServer())
        .post(`${BASE}/email/probe/prepare`)
        .set('Authorization', bearer)
        .expect(401)
    })
  })

  describe('list', () => {
    it('returns the registered integrations as strict, bounded, secret-free data', async () => {
      const { token } = await operator('integ-list@example.com')
      const res = await request(app.getHttpServer())
        .get(BASE)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      expect(res.headers['cache-control']).toBe('private, no-store')
      const body = integrationsResponseSchema.parse(res.body)
      expect(body.items.map((item) => item.id)).toEqual([
        'email',
        'storage',
        'oauth',
        'queue',
        'ai',
        'telegram',
      ])
      expect(body.items.length).toBeLessThanOrEqual(INTEGRATIONS_MAX)
      const text = JSON.stringify(res.body)
      const secrets = [
        process.env.JWT_SECRET,
        process.env.DATABASE_URL,
        process.env.REDIS_URL,
        process.env.RESEND_API_KEY,
      ].filter((secret): secret is string => Boolean(secret))
      expect(secrets.length).toBeGreaterThan(0)
      expect(secrets.filter((secret) => text.includes(secret))).toEqual([])
      expect(text).not.toContain('integ-list@example.com')
      expect(body.items.find((item) => item.id === 'email')?.action).toMatchObject({
        kind: 'operator_email_test',
      })
    })
  })

  describe('operator email test', () => {
    it('refuses an operator without a verified address, and sends nothing', async () => {
      const { token } = await operator('integ-unverified@example.com', false)
      const res = await request(app.getHttpServer())
        .post(`${BASE}/email/probe/prepare`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409)
      expect(res.body.errorCode).toBe('INTEGRATION_NO_VERIFIED_ADDRESS')
      const list = await request(app.getHttpServer())
        .get(BASE)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
      expect(list.body.items[0].action).toMatchObject({
        available: false,
        unavailableReason: 'no_verified_address',
      })
    })

    it('prepares, runs once, replays without a second send and recovers the receipt', async () => {
      const { token } = await operator('integ-run@example.com')
      const auth = { Authorization: `Bearer ${token}` }
      const prepared = probePreparationSchema.parse(
        (
          await request(app.getHttpServer())
            .post(`${BASE}/email/probe/prepare`)
            .set(auth)
            .expect(200)
        ).body
      )
      expect(prepared.recipientHint).toBe('i***@example.com')
      const run = await request(app.getHttpServer())
        .post(`${BASE}/email/probe`)
        .set(auth)
        .send({ attemptId: prepared.attemptId })
        .expect(200)
      const receipt = probeReceiptSchema.parse(run.body)
      expect(receipt).toMatchObject({ outcome: 'simulated', provider: 'mock', state: 'settled' })
      expect(JSON.stringify(run.body)).not.toContain('integ-run@example.com')

      const replay = await request(app.getHttpServer())
        .post(`${BASE}/email/probe`)
        .set(auth)
        .send({ attemptId: prepared.attemptId })
        .expect(200)
      expect(replay.body).toEqual(run.body)
      const read = await request(app.getHttpServer())
        .get(`${BASE}/email/probe/${prepared.attemptId}`)
        .set(auth)
        .expect(200)
      expect(read.body).toEqual(run.body)
      const list = await request(app.getHttpServer()).get(BASE).set(auth).expect(200)
      expect(list.body.items[0].evidence).toMatchObject({ result: 'simulated', freshness: 'fresh' })
      expect(list.body.items[0].action).toMatchObject({
        ownAttemptId: prepared.attemptId,
        unavailableReason: 'cooldown',
      })
    })

    it('answers an immediate second test with 429 and Retry-After, and an unknown id with 410', async () => {
      const { token } = await operator('integ-limit@example.com')
      const auth = { Authorization: `Bearer ${token}` }
      const first = await request(app.getHttpServer())
        .post(`${BASE}/email/probe/prepare`)
        .set(auth)
        .expect(200)
      await request(app.getHttpServer())
        .post(`${BASE}/email/probe`)
        .set(auth)
        .send({ attemptId: first.body.attemptId })
        .expect(200)
      const second = await request(app.getHttpServer())
        .post(`${BASE}/email/probe/prepare`)
        .set(auth)
        .expect(200)
      const refused = await request(app.getHttpServer())
        .post(`${BASE}/email/probe`)
        .set(auth)
        .send({ attemptId: second.body.attemptId })
        .expect(429)
      expect(refused.headers['retry-after']).toBeDefined()
      expect(refused.body.errorCode).toBe('INTEGRATION_PROBE_COOLDOWN')
      const unknown = await request(app.getHttpServer())
        .post(`${BASE}/email/probe`)
        .set(auth)
        .send({ attemptId: 'B'.repeat(22) })
        .expect(410)
      expect(unknown.body.errorCode).toBe('INTEGRATION_ATTEMPT_EXPIRED')
    })

    it('hides another operator’s attempt and rejects a body with extra fields', async () => {
      const first = await operator('integ-owner@example.com')
      const other = await operator('integ-other@example.com')
      const prepared = await request(app.getHttpServer())
        .post(`${BASE}/email/probe/prepare`)
        .set('Authorization', `Bearer ${first.token}`)
        .expect(200)
      await request(app.getHttpServer())
        .post(`${BASE}/email/probe`)
        .set('Authorization', `Bearer ${first.token}`)
        .send({ attemptId: prepared.body.attemptId })
        .expect(200)
      await request(app.getHttpServer())
        .get(`${BASE}/email/probe/${prepared.body.attemptId as string}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(404)
      await request(app.getHttpServer())
        .post(`${BASE}/email/probe`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ attemptId: prepared.body.attemptId, to: 'attacker@example.com' })
        .expect(400)
      const foreignRun = await request(app.getHttpServer())
        .post(`${BASE}/email/probe`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ attemptId: prepared.body.attemptId })
      expect(foreignRun.status).toBeGreaterThanOrEqual(400)
    })

    it('answers 404 for an integration without a registered probe', async () => {
      const { token } = await operator('integ-noprobe@example.com')
      await request(app.getHttpServer())
        .post(`${BASE}/storage/probe/prepare`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404)
    })
  })
})
