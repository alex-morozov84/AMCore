import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logPrimaryUnavailable } from '@/shared/lib/server-logger'

import { resolvePrimary } from './resolve-primary'
import type { DataOutcome } from './types'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/server-logger', () => ({ logPrimaryUnavailable: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolvePrimary', () => {
  it('returns an available outcome with the data on success, without logging', () => {
    const outcome: DataOutcome<{ id: string }> = { status: 'success', data: { id: 'p1' } }

    expect(resolvePrimary(outcome, { source: 'product-detail' })).toEqual({
      status: 'available',
      data: { id: 'p1' },
    })
    expect(logPrimaryUnavailable).not.toHaveBeenCalled()
  })

  it('logs exactly once and returns an unavailable outcome carrying the reason - never throws', () => {
    const outcome: DataOutcome<never> = {
      status: 'unavailable',
      reason: 'upstream',
      retryAfterMs: 500,
      correlationId: 'corr-1',
    }

    const result = resolvePrimary(outcome, { source: 'product-detail' })

    expect(result).toEqual({ status: 'unavailable', reason: 'upstream', retryAfterMs: 500 })
    expect(logPrimaryUnavailable).toHaveBeenCalledTimes(1)
    expect(logPrimaryUnavailable).toHaveBeenCalledWith({
      source: 'product-detail',
      reason: 'upstream',
      retryAfterMs: 500,
      correlationId: 'corr-1',
    })
  })

  it('calling it twice for the same failure logs twice (suppression, not dedup, is the volume control)', () => {
    const outcome: DataOutcome<never> = { status: 'unavailable', reason: 'timeout' }

    resolvePrimary(outcome, { source: 'product-detail' })
    resolvePrimary(outcome, { source: 'product-detail' })

    expect(logPrimaryUnavailable).toHaveBeenCalledTimes(2)
  })

  it('throws a plain error for a not-found outcome - caller must handle it explicitly', () => {
    const outcome: DataOutcome<never> = { status: 'not-found' }

    expect(() => resolvePrimary(outcome, { source: 'product-detail' })).toThrow(/notFound\(\)/)
    expect(logPrimaryUnavailable).not.toHaveBeenCalled()
  })
})
