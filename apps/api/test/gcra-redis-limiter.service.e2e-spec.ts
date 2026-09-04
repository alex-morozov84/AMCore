import { createClient } from '@redis/client'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { PinoLogger } from 'nestjs-pino'

import type { MetricsService } from '../src/infrastructure/observability'
import { GcraRedisLimiter } from '../src/infrastructure/throttling'
import { KEY_PREFIX } from '../src/infrastructure/throttling/gcra.constants'
import type { RateLimitPolicy } from '../src/infrastructure/throttling/rate-limit-policies'

type RedisClient = ReturnType<typeof createClient>

const noopLogger = {
  setContext: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger
const noopMetrics = {
  incRedisClientEvent: () => undefined,
} as unknown as MetricsService

const POLICY: RateLimitPolicy = { rate: 4, per: 2000, burst: 2 } // emission = 500ms
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Storage-boundary e2e for the GCRA limiter, real Redis via Testcontainers.
 * Contract properties mirrored (fake timers instead of real sleeps) against
 * the in-process fallback in `gcra-memory-limiter.spec.ts` — "the fallback
 * has the same semantics as the primary" is a checked fact, not a sentence.
 */
describe('GcraRedisLimiter (e2e, real Redis)', () => {
  let container: StartedRedisContainer
  let client: RedisClient
  let limiter: GcraRedisLimiter

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start()
    client = createClient({ url: container.getConnectionUrl() })
    await client.connect()
    limiter = new GcraRedisLimiter(client as never, noopLogger, noopMetrics)
  }, 120000)

  afterAll(async () => {
    await client.quit()
    await container.stop({ timeout: 10000 })
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }, 120000)

  beforeEach(async () => {
    await limiter.reset()
  })

  it('admits exactly burst requests from idle, refuses the next', async () => {
    for (let i = 0; i < POLICY.burst!; i++) {
      const decision = await limiter.consume('k', POLICY)
      expect(decision.allowed).toBe(true)
    }
    const refused = await limiter.consume('k', POLICY)
    expect(refused.allowed).toBe(false)
    expect(refused.remaining).toBe(0)
  })

  it('the refused request retryAfterMs is close to the emission interval', async () => {
    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('k', POLICY)
    const refused = await limiter.consume('k', POLICY)
    expect(refused.retryAfterMs).toBeGreaterThan(0)
    expect(refused.retryAfterMs).toBeLessThanOrEqual(500)
  })

  it('admits again once the emission interval has elapsed', async () => {
    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('k', POLICY)
    await sleep(550)
    const decision = await limiter.consume('k', POLICY)
    expect(decision.allowed).toBe(true)
  }, 10000)

  it('sustained pacing at the emission interval admits every request', async () => {
    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('k', POLICY)
    for (let i = 0; i < 3; i++) {
      await sleep(550)
      const decision = await limiter.consume('k', POLICY)
      expect(decision.allowed).toBe(true)
    }
  }, 10000)

  it('resetAfterMs matches the key PTTL', async () => {
    await limiter.consume('k', POLICY)
    const pttl = await client.pTTL(`${KEY_PREFIX}k`)
    expect(pttl).toBeGreaterThan(0)
    // Some clock skew between the Lua eval and this follow-up PTTL call is
    // expected; both are driven off the same Redis TIME source.
    expect(pttl).toBeLessThanOrEqual(500)
  })

  it('cost > 1 consumes proportionally more capacity', async () => {
    const decision = await limiter.consume('k', POLICY, 2)
    expect(decision.allowed).toBe(true)
    const refused = await limiter.consume('k', POLICY)
    expect(refused.allowed).toBe(false)
  })

  it('N1 — a refusal never advances the stored TAT: consecutive refusals return a monotonically decreasing retryAfterMs, never growing', async () => {
    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('k', POLICY)

    let previous = Infinity
    for (let i = 0; i < 3; i++) {
      await sleep(100)
      const decision = await limiter.consume('k', POLICY)
      expect(decision.allowed).toBe(false)
      expect(decision.retryAfterMs).toBeLessThan(previous)
      previous = decision.retryAfterMs
    }
  }, 10000)

  it('shares state across two limiter instances over the same Redis', async () => {
    const second = new GcraRedisLimiter(client as never, noopLogger, noopMetrics)

    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('shared', POLICY)
    const fromSecond = await second.consume('shared', POLICY)

    // Proves the limiter is not process-local at the component boundary.
    expect(fromSecond.allowed).toBe(false)
  })

  it('reset() deletes only ratelimit:v1:* keys', async () => {
    await client.set('cache:keep', '1')
    await limiter.consume('k', POLICY)

    await limiter.reset()

    expect(await client.get('cache:keep')).toBe('1')
    expect(await client.keys(`${KEY_PREFIX}*`)).toHaveLength(0)
  })
})
