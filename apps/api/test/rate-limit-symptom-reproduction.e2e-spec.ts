import { Controller, Get, type INestApplication } from '@nestjs/common'
import { APP_GUARD, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { PinoLogger } from 'nestjs-pino'
import request from 'supertest'

import { EnvService } from '../src/env/env.service'
import { MetricsService } from '../src/infrastructure/observability'
import {
  GcraRedisLimiter,
  RATE_LIMIT_POLICIES,
  RateLimit,
  RateLimitGuard,
} from '../src/infrastructure/throttling'

const noopLogger = {
  setContext: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger
const noopMetrics = {
  incRedisClientEvent: () => undefined,
  incRateLimitDecision: () => undefined,
} as unknown as MetricsService

@RateLimit(RATE_LIMIT_POLICIES.DEFAULT)
@Controller()
class CatalogProbeController {
  @Get('list')
  list() {
    return { ok: true }
  }
  @Get('facets')
  facets() {
    return { ok: true }
  }
}

/**
 * Reproduces the originally-reported production symptom end to end: a real
 * visitor browsing normally (5 sequential "page visits," each firing ~12
 * parallel requests split across two routes, matching a real filter-click
 * pattern) must never trip the global backstop under the shipped `DEFAULT`
 * policy. Real HTTP via supertest, real `RateLimitGuard`, real
 * `GcraRedisLimiter` against a real Redis container — not a mock, not the
 * in-memory fallback.
 *
 * Before/after, measured (recorded in the PR description, not only here):
 * the identical scenario against the OLD stock fixed-window
 * `TrustedWebPeerThrottlerGuard`/`@nestjs/throttler` setup (AMCore's real
 * shipped defaults, `short: 10/1s`) produced **28 of 60 requests refused
 * with 429** — a temporary, throwaway run in a scratch git worktree at the
 * pre-this-PR commit, never shipped (`@nestjs/throttler` is gone after this
 * PR). This spec is the permanent regression coverage for the "after" half.
 */
describe('Originally-reported-symptom reproduction (e2e, real Redis)', () => {
  let container: StartedRedisContainer
  let client: ReturnType<typeof createClient>
  let app: INestApplication

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start()
    client = createClient({ url: container.getConnectionUrl() })
    await client.connect()

    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogProbeController],
      providers: [
        Reflector,
        {
          provide: GcraRedisLimiter,
          useValue: new GcraRedisLimiter(client as never, noopLogger, noopMetrics),
        },
        { provide: EnvService, useValue: { get: () => undefined } },
        { provide: MetricsService, useValue: noopMetrics },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.init()
    // Explicit listen before any parallel supertest traffic — passing an
    // un-listened server to multiple concurrent `request()` calls races
    // supertest's own implicit `.listen(0)`, producing spurious ECONNRESET
    // (reproduced and fixed while building this exact spec).
    await app.listen(0, '127.0.0.1')
  }, 120000)

  afterAll(async () => {
    // Guard against a failed beforeAll (e.g. a DI resolution error) leaving
    // `app` unset — closing only what actually got built avoids a secondary
    // crash masking the real one, and avoids leaking the Redis container.
    await app?.close()
    await client?.quit()
    await container.stop({ timeout: 10000 })
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }, 120000)

  it('zero 429s across 5 visits x 12 parallel requests (6/route) under the DEFAULT policy', async () => {
    const address = app.getHttpServer().address() as { port: number }
    const server = `http://127.0.0.1:${address.port}`

    let count200 = 0
    let count429 = 0

    for (let visit = 0; visit < 5; visit++) {
      const calls = [
        ...Array.from({ length: 6 }, () => request(server).get('/list')),
        ...Array.from({ length: 6 }, () => request(server).get('/facets')),
      ]
      const results = await Promise.all(calls)
      for (const res of results) {
        if (res.status === 200) count200++
        else if (res.status === 429) count429++
      }
      if (visit < 4) await new Promise((resolve) => setTimeout(resolve, 400))
    }

    expect(count429).toBe(0)
    expect(count200).toBe(60)
  })
})
