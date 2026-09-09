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
  it('returns the data on success without logging', () => {
    const outcome: DataOutcome<{ id: string }> = { status: 'success', data: { id: 'p1' } }

    expect(degradeSecondary(outcome, { source: 'facets' })).toEqual({ id: 'p1' })
    expect(logDegradation).not.toHaveBeenCalled()
  })

  it('returns undefined and logs once for a known unavailable outcome', () => {
    const outcome: DataOutcome<never> = {
      status: 'unavailable',
      reason: 'timeout',
      retryAfterMs: undefined,
      correlationId: 'corr-1',
    }

    expect(degradeSecondary(outcome, { source: 'facets' })).toBeUndefined()
    expect(logDegradation).toHaveBeenCalledWith({
      event: 'secondary_data_degraded',
      source: 'facets',
      reason: 'timeout',
      retryAfterMs: undefined,
      correlationId: 'corr-1',
    })
  })

  it('throws (does not silently degrade) for a not-found outcome from a secondary source', () => {
    const outcome: DataOutcome<never> = { status: 'not-found' }

    expect(() => degradeSecondary(outcome, { source: 'facets' })).toThrow(/not-found/)
    expect(logDegradation).not.toHaveBeenCalled()
  })
})
