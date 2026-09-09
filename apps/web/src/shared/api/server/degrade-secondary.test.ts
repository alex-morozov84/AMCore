import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logDegradation } from '@/shared/lib/server-logger'

import { degradeSecondary } from './degrade-secondary'
import type { DataOutcome } from './types'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/server-logger', () => ({ logDegradation: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('degradeSecondary', () => {
  it('returns an available outcome with the data on success, without logging', () => {
    const outcome: DataOutcome<{ id: string }> = { status: 'success', data: { id: 'p1' } }

    expect(degradeSecondary(outcome, { source: 'facets' })).toEqual({
      status: 'available',
      data: { id: 'p1' },
    })
    expect(logDegradation).not.toHaveBeenCalled()
  })

  it('returns a degraded outcome carrying the reason, and logs once, for a known unavailable outcome', () => {
    const outcome: DataOutcome<never> = {
      status: 'unavailable',
      reason: 'timeout',
      retryAfterMs: undefined,
      correlationId: 'corr-1',
    }

    expect(degradeSecondary(outcome, { source: 'facets' })).toEqual({
      status: 'degraded',
      reason: 'timeout',
    })
    expect(logDegradation).toHaveBeenCalledWith({
      source: 'facets',
      reason: 'timeout',
      retryAfterMs: undefined,
      correlationId: 'corr-1',
    })
  })

  it('lets a caller build a hidden, disabled, or inline-note UI from the same degraded outcome', () => {
    const outcome: DataOutcome<never> = { status: 'unavailable', reason: 'rate-limited' }
    const result = degradeSecondary(outcome, { source: 'facets' })

    expect(result.status).toBe('degraded')
    if (result.status === 'degraded') {
      // The reason survives the primitive, unlike a plain `T | undefined`
      // return - a caller can pick copy/behavior per failure class.
      expect(result.reason).toBe('rate-limited')
    }
  })

  it('throws (does not silently degrade) for a not-found outcome from a secondary source', () => {
    const outcome: DataOutcome<never> = { status: 'not-found' }

    expect(() => degradeSecondary(outcome, { source: 'facets' })).toThrow(/not-found/)
    expect(logDegradation).not.toHaveBeenCalled()
  })
})
