import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import request from 'supertest'

import { OAuthProviderFactory } from '../src/core/auth/oauth/providers/oauth-provider.factory'
import type { OAuthProvider } from '../src/core/auth/oauth/providers/oauth-provider.interface'
import { PUBLIC_STEP_MS } from '../src/core/auth/stage/auth-stage.service'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

// The whole application runs against a real Redis container. `docker pause` freezes the Redis
// process: sockets stay open and no reply ever arrives, the stalled-dependency case. The
// recovery times are scoped acceptance targets for this fault class on this machine, not
// guarantees. A permanent outage is out of scope: requests keep returning a fast 503.
const STAGE_MS = 1000
const FAST_503_MS = STAGE_MS + 700
const RECOVERY_MS = 12000

describe('Authentication while Redis is stalled and when it returns', () => {
  let c: E2ETestContext
  let token: string
  let scoped: string
  let orgId: string
  const http = () => c.app.getHttpServer()
  const containerId = () => c.redisContainer.getId()
  const pause = (): void =>
    void execFileSync('docker', ['pause', containerId()], { stdio: 'ignore' })
  const unpause = (): void =>
    void execFileSync('docker', ['unpause', containerId()], { stdio: 'ignore' })

  // Organization-scoped requests carry the token issued by /switch: only those read the
  // permissions cache. The personal token never needs Redis for its user check.
  const timed = async (
    path: string,
    bearer = scoped
  ): Promise<{ status: number; body: Record<string, unknown>; ms: number }> => {
    const started = performance.now()
    const res = await request(http()).get(path).auth(bearer, { type: 'bearer' })
    return { status: res.status, body: res.body, ms: Math.round(performance.now() - started) }
  }

  beforeAll(async () => {
    c = await setupE2ETest()
    await seedSystemRoles(c.prisma)
  }, 180000)
  afterAll(async () => {
    try {
      unpause()
    } catch {
      // already running
    }
    if (c) await teardownE2ETest(c)
  }, 180000)
  beforeEach(async () => {
    await cleanOrgData(c.prisma)
    await cleanDatabase(c.prisma, c.cache, c.throttlerStorage)
    token = (
      await request(http())
        .post('/auth/register')
        .send({ email: 'outage-user@example.test', password: 'StrongP@ss123' })
        .expect(201)
    ).body.accessToken
    orgId = (
      await request(http())
        .post('/organizations')
        .auth(token, { type: 'bearer' })
        .send({ name: 'Outage org' })
        .expect(201)
    ).body.id
    scoped = (
      await request(http())
        .post(`/organizations/${orgId}/switch`)
        .auth(token, { type: 'bearer' })
        .expect(200)
    ).body.accessToken
  })
  afterEach(async () => {
    try {
      unpause()
    } catch {
      // not paused
    }
  })

  it('keeps a personal request working and answers an organization request with a fast 503', async () => {
    await c.cache.flush()
    const healthy = await timed(`/organizations/${orgId}`)
    expect(healthy.status).toBe(200)
    await c.cache.flush()

    pause()
    // The personal check reads the primary database only: no Redis dependency in that step.
    const personal = await timed('/auth/me', token)
    expect(personal.status).toBe(200)

    // A cold permissions cache needs Redis: it fails closed, quickly and with a typed answer.
    const org = await timed(`/organizations/${orgId}`)
    expect(org.status).toBe(503)
    expect(org.body).toMatchObject({ errorCode: 'SERVICE_UNAVAILABLE' })
    expect(org.ms).toBeLessThan(FAST_503_MS)
  }, 90000)

  it('refuses OAuth start and exchange with a typed 503, sets no cookie, and recovers', async () => {
    const providers = (
      c.app.get(OAuthProviderFactory) as unknown as { providers: Map<string, OAuthProvider> }
    ).providers
    providers.set('google', {
      name: 'google',
      getAuthorizationURL: async (state: string) =>
        new URL(`https://mock-oauth.example.com/authorize?state=${state}`),
      exchangeCode: async () => ({ accessToken: 'mock' }),
      getUserProfile: async () => {
        throw new Error('not used')
      },
    } as unknown as OAuthProvider)

    pause()
    const startedAt = performance.now()
    const start = await request(http()).get('/auth/oauth/google')
    expect(start.status).toBe(503)
    expect(start.body).toMatchObject({ errorCode: 'SERVICE_UNAVAILABLE' })
    // The binding cookie is set only after the one-time state was stored.
    expect(start.headers['set-cookie']).toBeUndefined()
    expect(performance.now() - startedAt).toBeLessThan(PUBLIC_STEP_MS + 700)

    const exchange = await request(http())
      .post('/auth/oauth/exchange')
      .set('Cookie', 'refresh_token=binding')
      .send({ ticket: 'ticket-1' })
    expect(exchange.status).toBe(503)
    expect(exchange.body).toMatchObject({ errorCode: 'SERVICE_UNAVAILABLE' })
    expect(exchange.headers['set-cookie']).toBeUndefined()

    await sleep(3500)
    unpause()
    const started = performance.now()
    let last = await request(http()).get('/auth/oauth/google')
    while (last.status !== 302 && performance.now() - started < RECOVERY_MS) {
      await sleep(250)
      last = await request(http()).get('/auth/oauth/google')
    }
    expect(last.status).toBe(302)
    expect(last.headers.location).toContain('mock-oauth.example.com/authorize')
  }, 120000)

  it('refuses every request in a burst within the admission budget', async () => {
    await c.cache.flush()
    pause()
    const results = await Promise.all(
      Array.from({ length: 25 }, () => timed(`/organizations/${orgId}`))
    )
    expect(results.every((r) => r.status === 503)).toBe(true)
    expect(Math.max(...results.map((r) => r.ms))).toBeLessThan(FAST_503_MS + 500)
  }, 90000)

  it('recovers after the stall clears: the same request succeeds again', async () => {
    await c.cache.flush()
    pause()
    expect((await timed(`/organizations/${orgId}`)).status).toBe(503)
    await sleep(3500)
    unpause()

    const started = performance.now()
    let last = await timed(`/organizations/${orgId}`)
    while (last.status !== 200 && performance.now() - started < RECOVERY_MS) {
      await sleep(250)
      last = await timed(`/organizations/${orgId}`)
    }
    expect(last.status).toBe(200)
    expect(Math.round(performance.now() - started)).toBeLessThan(RECOVERY_MS)
  }, 120000)
})
