import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logPrimaryUnavailable } from '@/shared/lib/server-logger'

import {
  isPrimaryUnavailableError,
  PrimaryUnavailableError,
  requirePrimary,
} from './require-primary'
import type { DataOutcome } from './types'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/server-logger', () => ({ logPrimaryUnavailable: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requirePrimary', () => {
  it('returns the data on success without logging', () => {
    const outcome: DataOutcome<{ id: string }> = { status: 'success', data: { id: 'p1' } }

    expect(requirePrimary(outcome, { source: 'product-detail' })).toEqual({ id: 'p1' })
    expect(logPrimaryUnavailable).not.toHaveBeenCalled()
  })

  it('logs exactly once, then throws PrimaryUnavailableError carrying the reason', () => {
    const outcome: DataOutcome<never> = {
      status: 'unavailable',
      reason: 'upstream',
      retryAfterMs: 500,
      correlationId: 'corr-1',
    }

    expect(() => requirePrimary(outcome, { source: 'product-detail' })).toThrow(
      PrimaryUnavailableError
    )
    expect(logPrimaryUnavailable).toHaveBeenCalledTimes(1)
    expect(logPrimaryUnavailable).toHaveBeenCalledWith({
      source: 'product-detail',
      reason: 'upstream',
      retryAfterMs: 500,
      correlationId: 'corr-1',
    })

    try {
      requirePrimary(outcome, { source: 'product-detail' })
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(PrimaryUnavailableError)
      expect((error as PrimaryUnavailableError).reason).toBe('upstream')
      expect((error as PrimaryUnavailableError).retryAfterMs).toBe(500)
      expect((error as PrimaryUnavailableError).correlationId).toBe('corr-1')
    }
  })

  it('throws a plain error (not PrimaryUnavailableError) for a not-found outcome - caller must handle it', () => {
    const outcome: DataOutcome<never> = { status: 'not-found' }

    expect(() => requirePrimary(outcome, { source: 'product-detail' })).toThrow(/notFound\(\)/)
    expect(() => requirePrimary(outcome, { source: 'product-detail' })).not.toThrow(
      PrimaryUnavailableError
    )
    expect(logPrimaryUnavailable).not.toHaveBeenCalled()
  })
})

describe('isPrimaryUnavailableError', () => {
  it('recognizes a real instance', () => {
    expect(isPrimaryUnavailableError(new PrimaryUnavailableError('timeout'))).toBe(true)
  })

  it('recognizes a duck-typed marker for a value that lost its prototype chain', () => {
    expect(isPrimaryUnavailableError({ isPrimaryUnavailableError: true })).toBe(true)
  })

  it('rejects an unrelated error', () => {
    expect(isPrimaryUnavailableError(new Error('something else'))).toBe(false)
    expect(isPrimaryUnavailableError(undefined)).toBe(false)
  })
})
