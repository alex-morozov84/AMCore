// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { isCspReportRateLimited } from './csp-report-rate-limit'

vi.mock('server-only', () => ({}))

function makeFakeRedis() {
  return {
    incr: vi.fn(),
    expire: vi.fn(),
  }
}

describe('isCspReportRateLimited', () => {
  it('allows the report through while under the window limit', async () => {
    const redis = makeFakeRedis()
    redis.incr.mockResolvedValue(5)

    expect(await isCspReportRateLimited(redis as never, 'client-a')).toBe(false)
  })

  it('sets an expiry only on the first request in a window', async () => {
    const redis = makeFakeRedis()
    redis.incr.mockResolvedValue(1)

    await isCspReportRateLimited(redis as never, 'client-a')

    expect(redis.expire).toHaveBeenCalledWith(
      expect.stringContaining('client-a'),
      expect.any(Number)
    )
  })

  it('does not re-set the expiry on subsequent requests', async () => {
    const redis = makeFakeRedis()
    redis.incr.mockResolvedValue(2)

    await isCspReportRateLimited(redis as never, 'client-a')

    expect(redis.expire).not.toHaveBeenCalled()
  })

  it('rate-limits once the window limit is exceeded', async () => {
    const redis = makeFakeRedis()
    redis.incr.mockResolvedValue(21)

    expect(await isCspReportRateLimited(redis as never, 'client-a')).toBe(true)
  })

  it('fails open (allows through) if Redis throws', async () => {
    const redis = makeFakeRedis()
    redis.incr.mockRejectedValue(new Error('connection reset'))

    expect(await isCspReportRateLimited(redis as never, 'client-a')).toBe(false)
  })

  it('keys different clients independently', async () => {
    const redis = makeFakeRedis()
    redis.incr.mockResolvedValue(1)

    await isCspReportRateLimited(redis as never, 'client-a')
    await isCspReportRateLimited(redis as never, 'client-b')

    const keysUsed = redis.incr.mock.calls.map((call) => call[0])
    expect(new Set(keysUsed).size).toBe(2)
  })
})
