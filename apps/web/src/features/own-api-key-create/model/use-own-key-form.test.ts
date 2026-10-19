import { describe, expect, it, vi } from 'vitest'

import { resolveOwnKeyExpiry } from './use-own-key-form'

vi.mock('client-only', () => ({}))
describe('ready expiry conversion', () => {
  const now = Date.UTC(2026, 9, 19)
  it('freezes relative expiry at submit and supports intentional no-expiry', () => {
    expect(resolveOwnKeyExpiry('30', '', now)).toBe('2026-11-18T00:00:00.000Z')
    expect(resolveOwnKeyExpiry('none', '', now)).toBeUndefined()
  })
  it('rejects nonexistent calendar dates, malformed input and past local dates', () => {
    for (const value of ['2027-02-30T12:00', '2020-01-01T12:00', 'bad'])
      expect(() => resolveOwnKeyExpiry('custom', value, now)).toThrow('INVALID_EXPIRY')
  })
  it('rejects a DST gap instead of silently moving a custom local time', () => {
    vi.stubEnv('TZ', 'America/New_York')
    try {
      expect(() => resolveOwnKeyExpiry('custom', '2027-03-14T02:30', now)).toThrow('INVALID_EXPIRY')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
