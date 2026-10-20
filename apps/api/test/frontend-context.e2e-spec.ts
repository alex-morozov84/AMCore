import { createHash, randomBytes } from 'node:crypto'

import request from 'supertest'

import { frontendPlacementPayload, WEB_FRONTEND_HEADERS } from '@amcore/shared'

import { TokenManagerService } from '../src/core/auth/token-manager.service'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

const site = 'http://localhost:3002'
const key = randomBytes(32).toString('hex')
const fingerprint = createHash('sha256').update(frontendPlacementPayload(site, site)).digest('hex')
const admin = { frontend: 'admin' as const, placementFingerprint: fingerprint }
const proof = (frontend: 'site' | 'admin') => ({
  [WEB_FRONTEND_HEADERS.frontend]: frontend,
  [WEB_FRONTEND_HEADERS.placement]: fingerprint,
  [WEB_FRONTEND_HEADERS.key]: key,
  origin: site,
})

describe('frontend proof and email-token destinations (e2e)', () => {
  let context: E2ETestContext
  const previous = new Map<string, string | undefined>()
  beforeAll(async () => {
    for (const [name, value] of Object.entries({
      FRONTEND_URL: site,
      PRODUCT_ADMIN_ORIGIN: '',
      WEB_FRONTEND_CONTEXT_KEY: key,
      EMAIL_PROVIDER: 'mock',
      AUTH_PUBLIC_SIGNUP_ENABLED: 'true',
    })) {
      previous.set(name, process.env[name])
      process.env[name] = value
    }
    context = await setupE2ETest()
  }, 120000)
  afterAll(async () => {
    await teardownE2ETest(context)
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }, 120000)
  beforeEach(async () => {
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
  })

  async function register() {
    const response = await request(context.app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'destination@example.test', password: 'Test1234Secure' })
      .expect(201)
    return response.body.user.id as string
  }

  it.each([
    { [WEB_FRONTEND_HEADERS.frontend]: 'admin' },
    { ...proof('admin'), [WEB_FRONTEND_HEADERS.key]: '<wrong-proof>' },
  ])('rejects partial/forged proof before registration effects', async (headers) => {
    await request(context.app.getHttpServer())
      .post('/auth/register')
      .set(headers)
      .send({ email: 'rejected@example.test', password: 'Test1234Secure' })
      .expect(403)
    expect(await context.prisma.user.count()).toBe(0)
    expect(await context.prisma.session.count()).toBe(0)
  })

  it('rejects deployment disagreement before token/session/user creation', async () => {
    await request(context.app.getHttpServer())
      .post('/auth/register')
      .set({ ...proof('admin'), [WEB_FRONTEND_HEADERS.placement]: 'b'.repeat(64) })
      .send({ email: 'rejected@example.test', password: 'Test1234Secure' })
      .expect(503)
    expect(await context.prisma.user.count()).toBe(0)
    expect(await context.prisma.emailVerificationToken.count()).toBe(0)
    expect(await context.prisma.session.count()).toBe(0)
  })

  it('retains native issuance defaults and binds browser password recovery to admin', async () => {
    const id = await register()
    const initial = await context.prisma.emailVerificationToken.findFirstOrThrow({
      where: { userId: id },
    })
    expect(initial.frontendDestination).toBe('site')
    expect(initial.placementFingerprint).toBeNull()
    await request(context.app.getHttpServer())
      .post('/auth/forgot-password')
      .set(proof('admin'))
      .send({ email: 'destination@example.test' })
      .expect(200)
    const reset = await context.prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: id },
    })
    expect(reset.frontendDestination).toBe('admin')
    expect(reset.placementFingerprint).toBe(fingerprint)
  })

  it('refuses another browser surface without consuming a reset token', async () => {
    const id = await register()
    const token = await context.app.get(TokenManagerService).generatePasswordResetToken(id, admin)
    const body = { token: token.token, password: 'New1234Secure' }
    await request(context.app.getHttpServer())
      .post('/auth/reset-password')
      .set(proof('site'))
      .send(body)
      .expect(401)
    expect(
      (await context.prisma.passwordResetToken.findFirstOrThrow({ where: { userId: id } })).used
    ).toBe(false)
    await request(context.app.getHttpServer())
      .post('/auth/reset-password')
      .set(proof('admin'))
      .send(body)
      .expect(204)
    expect(
      (await context.prisma.passwordResetToken.findFirstOrThrow({ where: { userId: id } })).used
    ).toBe(true)
  })

  it('keeps legacy site verification and explicit native admin-token consumption compatible', async () => {
    const id = await register()
    const tokens = context.app.get(TokenManagerService)
    const legacy = await tokens.generateEmailVerificationToken(id)
    await request(context.app.getHttpServer())
      .post('/auth/verify-email')
      .set(proof('site'))
      .send({ token: legacy.token })
      .expect(204)
    const reset = await tokens.generatePasswordResetToken(id, admin)
    await request(context.app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: reset.token, password: 'Native1234Secure' })
      .expect(204)
  })
})
