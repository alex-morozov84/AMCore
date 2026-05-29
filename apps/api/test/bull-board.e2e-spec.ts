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

/**
 * Bull Board access control (EQS-01).
 *
 * The e2e harness runs under NODE_ENV=test (non-production), so the dashboard
 * is mounted and these tests exercise the auth middleware. The
 * production-default "not mounted" behavior is proven by the pure gate unit
 * test (`bull-board-mount-gate.spec.ts`) — booting a production app here would
 * require a contrived prod env (SSL DATABASE_URL, CORS) unrelated to this fix.
 *
 * Path note: the e2e harness applies no global prefix (see
 * helpers.setupE2ETest), so here the dashboard lives at `/admin/queues`. In a
 * production bootstrap with `setGlobalPrefix('api/v1')` the URL follows the
 * prefix (`/api/v1/admin/queues`) — but auth coverage is path-independent: the
 * auth middleware and the Bull Board router are bound in the same
 * `consumer.apply(middleware, router).forRoutes(route)` call, so they mount at
 * the identical path wherever that resolves to. These tests therefore prove
 * the security invariant (auth gates the router + its subroutes) regardless of
 * the deployed prefix.
 */
describe('Bull Board (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext

  const ROUTE = '/admin/queues'
  // A path under the dashboard base — the Bull Board data API. Whatever the
  // exact route, an unauthenticated request must be denied by the middleware
  // before it can reveal job payloads.
  const SUBROUTE = '/admin/queues/api/queues'

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

  function refreshCookie(res: request.Response): string {
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    const rt = setCookie.find((c) => c.startsWith('refresh_token='))
    if (!rt) throw new Error('no refresh_token cookie in response')
    return rt.split(';')[0]!
  }

  async function registerUser(email: string): Promise<{ cookie: string; userId: string }> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'StrongP@ss123' })
      .expect(201)
    return { cookie: refreshCookie(res), userId: res.body.user.id as string }
  }

  it('denies an unauthenticated request (no cookie)', async () => {
    await request(app.getHttpServer()).get(ROUTE).expect(401)
  })

  it('denies a regular (non-SUPER_ADMIN) user', async () => {
    const { cookie } = await registerUser('user@example.com')

    await request(app.getHttpServer()).get(ROUTE).set('Cookie', cookie).expect(403)
  })

  it('allows a SUPER_ADMIN user', async () => {
    const { cookie, userId } = await registerUser('superadmin@example.com')
    // Promote in place: verifyAccess reads systemRole live, so the existing
    // session cookie now authorizes (no re-login needed).
    await prisma.user.update({ where: { id: userId }, data: { systemRole: 'SUPER_ADMIN' } })

    await request(app.getHttpServer()).get(ROUTE).set('Cookie', cookie).expect(200)
  })

  it('rejects an API key on the Authorization header', async () => {
    const apiKey = 'amcore_live_shorttoken0_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

    await request(app.getHttpServer())
      .get(ROUTE)
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(401)
  })

  it('rejects an x-api-key header', async () => {
    await request(app.getHttpServer()).get(ROUTE).set('x-api-key', 'whatever').expect(401)
  })

  it('applies the same policy to a UI subroute / data endpoint (unauth → denied)', async () => {
    // Critical: the data API under the base path must not be reachable
    // without auth, or job payloads (verification/reset/invite token URLs)
    // would leak even though the root page is protected.
    const res = await request(app.getHttpServer()).get(SUBROUTE)
    expect(res.status).not.toBe(200)
    expect([401, 403]).toContain(res.status)
  })

  it('allows a SUPER_ADMIN on the UI subroute / data endpoint', async () => {
    const { cookie, userId } = await registerUser('superadmin@example.com')
    await prisma.user.update({ where: { id: userId }, data: { systemRole: 'SUPER_ADMIN' } })

    const res = await request(app.getHttpServer()).get(SUBROUTE).set('Cookie', cookie)
    // The route is reachable (not blocked by auth). Bull Board may answer 200.
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})
