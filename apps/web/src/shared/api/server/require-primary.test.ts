import { describe, expect, it } from 'vitest'

import { PrimaryUnavailableError, requirePrimary } from './require-primary'
import type { DataOutcome } from './types'

describe('requirePrimary', () => {
  it('returns the data on success', () => {
    const outcome: DataOutcome<{ id: string }> = { status: 'success', data: { id: 'p1' } }
    expect(requirePrimary(outcome)).toEqual({ id: 'p1' })
  })

  it('throws PrimaryUnavailableError carrying the reason for an unavailable outcome', () => {
    const outcome: DataOutcome<never> = {
      status: 'unavailable',
      reason: 'upstream',
      retryAfterMs: 500,
      correlationId: 'corr-1',
    }

    expect(() => requirePrimary(outcome)).toThrow(PrimaryUnavailableError)
    try {
      requirePrimary(outcome)
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(PrimaryUnavailableError)
      expect((error as PrimaryUnavailableError).reason).toBe('upstream')
      expect((error as PrimaryUnavailableError).retryAfterMs).toBe(500)
      expect((error as PrimaryUnavailableError).correlationId).toBe('corr-1')
    }
  })

  it('throws a plain error (not PrimaryUnavailableError) for a not-found outcome — caller must handle it', () => {
    const outcome: DataOutcome<never> = { status: 'not-found' }

    expect(() => requirePrimary(outcome)).toThrow(/notFound\(\)/)
    expect(() => requirePrimary(outcome)).not.toThrow(PrimaryUnavailableError)
  })
})
