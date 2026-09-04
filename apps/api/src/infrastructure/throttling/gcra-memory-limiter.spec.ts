import { GcraMemoryLimiter } from './gcra-memory-limiter'
import type { RateLimitPolicy } from './rate-limit-policies'

/**
 * Contract properties (mirrored, with real small sleeps instead of fake
 * timers, against real Redis in `gcra-redis-limiter.service.e2e-spec.ts`) —
 * "the fallback has the same semantics as the primary" is a checked fact,
 * not a sentence.
 */
describe('GcraMemoryLimiter', () => {
  const POLICY: RateLimitPolicy = { rate: 5, per: 5000, burst: 3 } // emission = 1000ms
  let limiter: GcraMemoryLimiter

  beforeEach(() => {
    jest.useFakeTimers()
    limiter = new GcraMemoryLimiter()
  })

  afterEach(() => {
    limiter.onApplicationShutdown()
    jest.useRealTimers()
  })

  it('admits exactly burst requests from idle, refuses the next', async () => {
    for (let i = 0; i < POLICY.burst!; i++) {
      const decision = await limiter.consume('k1', POLICY)
      expect(decision.allowed).toBe(true)
    }
    const refused = await limiter.consume('k1', POLICY)
    expect(refused.allowed).toBe(false)
    expect(refused.remaining).toBe(0)
  })

  it('the refused request retryAfterMs equals the emission interval', async () => {
    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('k1', POLICY)
    const refused = await limiter.consume('k1', POLICY)
    expect(refused.retryAfterMs).toBe(1000) // period/rate = 5000/5
  })

  it('admits again exactly emission ms after exhausting burst', async () => {
    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('k1', POLICY)
    await jest.advanceTimersByTimeAsync(1000)
    const decision = await limiter.consume('k1', POLICY)
    expect(decision.allowed).toBe(true)
  })

  it('sustained pacing at exactly the emission interval admits every request', async () => {
    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('k1', POLICY)
    for (let i = 0; i < 3; i++) {
      await jest.advanceTimersByTimeAsync(1000)
      const decision = await limiter.consume('k1', POLICY)
      expect(decision.allowed).toBe(true)
    }
  })

  it('resetAfterMs equals the time until the bucket is idle-full again', async () => {
    const decision = await limiter.consume('k1', POLICY)
    // One admitted request from idle: bucket refills fully in `emission` ms.
    expect(decision.resetAfterMs).toBe(1000)
  })

  it('cost > 1 consumes proportionally more capacity', async () => {
    const decision = await limiter.consume('k1', POLICY, 2)
    expect(decision.allowed).toBe(true)
    // Two more unit-cost requests should now refuse — cost=2 used 2/3 of burst.
    await limiter.consume('k1', POLICY)
    const third = await limiter.consume('k1', POLICY)
    expect(third.allowed).toBe(false)
  })

  it('N1 — a refusal never advances the stored TAT: consecutive refusals return a monotonically decreasing retryAfterMs, never growing', async () => {
    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('k1', POLICY)

    let previous = Infinity
    for (let i = 0; i < 3; i++) {
      await jest.advanceTimersByTimeAsync(100)
      const decision = await limiter.consume('k1', POLICY)
      expect(decision.allowed).toBe(false)
      expect(decision.retryAfterMs).toBeLessThan(previous)
      previous = decision.retryAfterMs
    }
  })

  it('two different keys never share a bucket', async () => {
    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('k1', POLICY)
    const other = await limiter.consume('k2', POLICY)
    expect(other.allowed).toBe(true)
  })

  it('reset() drops all held state', async () => {
    for (let i = 0; i < POLICY.burst!; i++) await limiter.consume('k1', POLICY)
    limiter.reset()
    const decision = await limiter.consume('k1', POLICY)
    expect(decision.allowed).toBe(true)
  })
})
