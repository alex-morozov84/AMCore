// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { isCspReportRateLimited } from './csp-report-rate-limit'

vi.mock('server-only', () => ({}))

describe('isCspReportRateLimited', () => {
  it.each([
    [20, false],
    [21, true],
  ])('checks count %i against the window', async (count, blocked) => {
    const redis = { eval: vi.fn().mockResolvedValue(count) }
    expect(await isCspReportRateLimited(redis, 'client-a')).toBe(blocked)
    expect(redis.eval).toHaveBeenCalledOnce()
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), {
      keys: ['csp-report-rate-limit:client-a'],
      arguments: ['10'],
    })
  })
})
