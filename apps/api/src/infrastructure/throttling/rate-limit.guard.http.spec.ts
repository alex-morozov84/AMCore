import { Controller, Get, type INestApplication } from '@nestjs/common'
import { APP_GUARD, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { EnvService } from '../../env/env.service'
import { MetricsService } from '../observability'

import { GcraMemoryLimiter } from './gcra-memory-limiter'
import { GcraRedisLimiter } from './gcra-redis-limiter.service'
import { RateLimit, SkipRateLimit } from './rate-limit.decorator'
import { RateLimitGuard } from './rate-limit.guard'

const PROBE_POLICY = { rate: 50, per: 60_000, burst: 50 }
const HANDLER_OVERRIDE_POLICY = { rate: 2, per: 60_000, burst: 2 }

@RateLimit(PROBE_POLICY)
@Controller()
class PingController {
  @Get('ping')
  ping() {
    return { ok: true }
  }

  @Get('ping-override')
  @RateLimit(HANDLER_OVERRIDE_POLICY)
  pingOverride() {
    return { ok: true }
  }

  @Get('ping-skip')
  @SkipRateLimit()
  pingSkip() {
    return { ok: true }
  }
}

/**
 * Real Nest app, real `RateLimitGuard`, real HTTP over a real loopback
 * socket via supertest. Uses `GcraMemoryLimiter` in place of
 * `GcraRedisLimiter` (Nest `useClass` substitution) — this spec is about
 * the guard's policy-resolution/header/skip behavior, not Redis semantics
 * (covered by `gcra-redis-limiter.service.e2e-spec.ts`, Testcontainers).
 */
async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [PingController],
    providers: [
      Reflector,
      { provide: GcraRedisLimiter, useClass: GcraMemoryLimiter },
      { provide: EnvService, useValue: { get: () => undefined } },
      { provide: MetricsService, useValue: { incRateLimitDecision: jest.fn() } },
      { provide: APP_GUARD, useClass: RateLimitGuard },
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  await app.init()
  return app
}

describe('RateLimitGuard — real guard + HTTP (ADR-073)', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  it('admits exactly burst requests from idle, refuses the next with a real 429', async () => {
    app = await buildApp()
    const server = app.getHttpServer()

    for (let i = 0; i < HANDLER_OVERRIDE_POLICY.burst; i++) {
      await request(server).get('/ping-override').expect(200)
    }
    const res = await request(server).get('/ping-override').expect(429)
    expect(res.body.errorCode).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('handler-level policy overrides class-level', async () => {
    // /ping-override has burst=2 (handler) vs /ping's class-level burst=50 —
    // if the class-level policy leaked through, this would take 50 requests
    // to 429, not 2.
    app = await buildApp()
    const server = app.getHttpServer()

    await request(server).get('/ping-override').expect(200)
    await request(server).get('/ping-override').expect(200)
    await request(server).get('/ping-override').expect(429)
  })

  it('@SkipRateLimit() route never 429s', async () => {
    app = await buildApp()
    const server = app.getHttpServer()

    for (let i = 0; i < HANDLER_OVERRIDE_POLICY.burst + 5; i++) {
      await request(server).get('/ping-skip').expect(200)
    }
  })

  it('a different route is unaffected — separate bucket per route per tracker', async () => {
    app = await buildApp()
    const server = app.getHttpServer()

    await request(server).get('/ping-override').expect(200)
    await request(server).get('/ping-override').expect(200)
    await request(server).get('/ping-override').expect(429)
    // /ping has its own class-level policy (burst 50) — unaffected by
    // /ping-override's exhausted bucket.
    await request(server).get('/ping').expect(200)
  })

  it('emits unsuffixed X-RateLimit-* headers with X-RateLimit-Limit = burst, and a whole-second Retry-After on refusal', async () => {
    app = await buildApp()
    const server = app.getHttpServer()

    const first = await request(server).get('/ping-override').expect(200)
    expect(first.headers['x-ratelimit-limit']).toBe(String(HANDLER_OVERRIDE_POLICY.burst))
    expect(first.headers['x-ratelimit-remaining']).toBe(String(HANDLER_OVERRIDE_POLICY.burst - 1))
    expect(first.headers['x-ratelimit-limit-short']).toBeUndefined()
    expect(first.headers['x-ratelimit-limit-long']).toBeUndefined()

    await request(server).get('/ping-override').expect(200)
    const refused = await request(server).get('/ping-override').expect(429)
    expect(refused.headers['x-ratelimit-remaining']).toBe('0')
    expect(refused.headers['retry-after']).toMatch(/^\d+$/)
    expect(refused.headers['retry-after-short']).toBeUndefined()
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1)
  })
})
