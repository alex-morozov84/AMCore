import { jest } from '@jest/globals'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import request from 'supertest'

import { BULL_BOARD_CONTEXT_HEADER, DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@amcore/shared'

import { PrivilegedRoleService } from '../src/core/auth/privileged-role.service'
import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  signAccessToken,
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

  describe('bearer admission (the Console BFF)', () => {
    const API = `${ROUTE}/api/queues`
    // Supported locales, not spelled-out ones: a fork that keeps a single locale supports only that.
    const CONTEXT = {
      basePath: '/api/console/bull-board',
      locale: DEFAULT_LOCALE,
      returnHref: '/admin/background-work',
    }
    const OTHER_LOCALE = SUPPORTED_LOCALES.at(-1) ?? DEFAULT_LOCALE
    /** What the board shows for a locale: its read-only label and its language tag. */
    const expectedFor = (locale: string) =>
      locale === 'ru'
        ? { label: 'ТОЛЬКО ПРОСМОТР', language: 'ru-RU' }
        : { label: 'READ-ONLY', language: 'en-US' }
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url')

    async function actor(
      email: string,
      claimRole: 'SUPER_ADMIN' | 'USER',
      databaseRole: 'SUPER_ADMIN' | 'USER'
    ): Promise<{ token: string; cookie: string; userId: string }> {
      const { cookie, userId } = await registerUser(email)
      await prisma.user.update({ where: { id: userId }, data: { systemRole: databaseRole } })
      const token = signAccessToken(app, { sub: userId, email, systemRole: claimRole })
      return { token, cookie, userId }
    }

    const get = (path: string, token?: string) => {
      const req = request(app.getHttpServer()).get(path)
      return token ? req.set('Authorization', `Bearer ${token}`) : req
    }

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('admits a SUPER_ADMIN claim that the database still confirms, without any cookie', async () => {
      const { token } = await actor('bearer-admin@example.com', 'SUPER_ADMIN', 'SUPER_ADMIN')
      expect((await get(API, token)).status).toBe(200)
      expect((await get(ROUTE + '/', token)).status).toBe(200)
    })

    it('refuses a USER claim with 403', async () => {
      const { token } = await actor('bearer-user@example.com', 'USER', 'USER')
      expect((await get(API, token)).status).toBe(403)
    })

    it('refuses a demoted admin on the next request, with the very same token', async () => {
      const { token, userId } = await actor(
        'bearer-demoted@example.com',
        'SUPER_ADMIN',
        'SUPER_ADMIN'
      )
      expect((await get(API, token)).status).toBe(200)
      await prisma.user.update({ where: { id: userId }, data: { systemRole: 'USER' } })
      expect((await get(API, token)).status).toBe(403)
    })

    it('never lets the database promote a USER claim', async () => {
      const { token } = await actor('bearer-promoted@example.com', 'USER', 'SUPER_ADMIN')
      expect((await get(API, token)).status).toBe(403)
    })

    it('answers 401 for a token of a user that does not exist', async () => {
      const token = signAccessToken(app, {
        sub: '00000000-0000-4000-8000-000000000000',
        email: 'ghost@example.com',
        systemRole: 'SUPER_ADMIN',
      })
      expect((await get(API, token)).status).toBe(401)
    })

    it.each([
      ['garbage', 'not-a-jwt'],
      ['an API key', 'amcore_live_shorttoken0_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ])('answers 401 for %s', async (_label, token) => {
      expect((await get(API, token)).status).toBe(401)
    })

    it('answers 401 for an expired token', async () => {
      const { userId } = await actor('bearer-expired@example.com', 'SUPER_ADMIN', 'SUPER_ADMIN')
      const token = app
        .get(JwtService, { strict: false })
        .sign(
          { sub: userId, email: 'bearer-expired@example.com', systemRole: 'SUPER_ADMIN' },
          { expiresIn: '-1m' }
        )
      expect((await get(API, token)).status).toBe(401)
    })

    it('answers 503, not a denial, when the role cannot be verified', async () => {
      const { token } = await actor('bearer-outage@example.com', 'SUPER_ADMIN', 'SUPER_ADMIN')
      jest
        .spyOn(PrivilegedRoleService.prototype, 'getCurrentSystemRole')
        .mockRejectedValue(new Error('pool timeout'))
      expect((await get(API, token)).status).toBe(503)
    })

    it('judges an Authorization header only as a bearer, in both directions', async () => {
      const admin = await actor('mixed-admin@example.com', 'SUPER_ADMIN', 'SUPER_ADMIN')
      const user = await actor('mixed-user@example.com', 'USER', 'USER')
      expect((await get(API, 'not-a-jwt').set('Cookie', admin.cookie)).status).toBe(401)
      expect((await get(API, admin.token).set('Cookie', user.cookie)).status).toBe(200)
      expect((await get(API, user.token).set('Cookie', admin.cookie)).status).toBe(403)
    })

    it('refuses a SUPER_ADMIN API key sent with x-api-key even next to a valid bearer', async () => {
      const { token } = await actor('bearer-key@example.com', 'SUPER_ADMIN', 'SUPER_ADMIN')
      expect((await get(API, token).set('x-api-key', 'anything')).status).toBe(401)
    })

    it('renders the page with the render context of the bearer request', async () => {
      const { token } = await actor('ctx-admin@example.com', 'SUPER_ADMIN', 'SUPER_ADMIN')
      const res = await get(`${ROUTE}/`, token)
        .set(
          BULL_BOARD_CONTEXT_HEADER,
          encode({ ...CONTEXT, locale: OTHER_LOCALE, returnHref: '/back/to/console' })
        )
        .expect(200)
      expect(res.text).toContain('<base href="/api/console/bull-board/"')
      expect(res.text).toContain(expectedFor(OTHER_LOCALE).label)
      expect(res.text).toContain('/back/to/console')
      expect(res.text).toContain(expectedFor(OTHER_LOCALE).language)
    })

    it('does not mix the render contexts of concurrent requests', async () => {
      const { token } = await actor('ctx-concurrent@example.com', 'SUPER_ADMIN', 'SUPER_ADMIN')
      const contexts = [
        { basePath: '/api/console/bull-board', locale: DEFAULT_LOCALE, returnHref: '/back/one' },
        { basePath: '/api/bull-board', locale: OTHER_LOCALE, returnHref: '/back/two' },
      ]
      const pages = await Promise.all(
        Array.from({ length: 8 }, (_unused, index) => {
          const context = contexts[index % 2]!
          return get(`${ROUTE}/`, token)
            .set(BULL_BOARD_CONTEXT_HEADER, encode(context))
            .then((res) => ({ context, text: res.text }))
        })
      )
      for (const { context, text } of pages) {
        expect(text).toContain(`<base href="${context.basePath}/"`)
        expect(text).toContain(context.returnHref)
        expect(text).toContain(expectedFor(context.locale).label)
        const other = contexts.find((candidate) => candidate !== context)!
        expect(text).not.toContain(`<base href="${other.basePath}/"`)
      }
    })

    it.each([
      ['malformed', 'not base64!'],
      ['an extra key', encode({ ...CONTEXT, role: 'SUPER_ADMIN' })],
      ['an absolute base path', encode({ ...CONTEXT, basePath: 'https://evil.example/' })],
      ['a protocol-relative return link', encode({ ...CONTEXT, returnHref: '//evil.example' })],
    ])('answers 400 for %s render context', async (_label, header) => {
      const { token } = await actor('ctx-bad@example.com', 'SUPER_ADMIN', 'SUPER_ADMIN')
      expect((await get(`${ROUTE}/`, token).set(BULL_BOARD_CONTEXT_HEADER, header)).status).toBe(
        400
      )
    })

    it('ignores the render context on a cookie request and keeps the internal base path', async () => {
      const { cookie } = await actor('ctx-cookie@example.com', 'SUPER_ADMIN', 'SUPER_ADMIN')
      const res = await request(app.getHttpServer())
        .get(`${ROUTE}/`)
        .set('Cookie', cookie)
        .set(BULL_BOARD_CONTEXT_HEADER, encode(CONTEXT))
        .expect(200)
      expect(res.text).toContain('<base href="/admin/queues/"')
      expect(res.text).not.toContain('/api/console/bull-board')
      expect(res.text).toContain('READ-ONLY')
    })
  })
})
