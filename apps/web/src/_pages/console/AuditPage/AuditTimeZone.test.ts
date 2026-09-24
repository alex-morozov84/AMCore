import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatInputInstant, parseInputInstant } from './AuditTimeZone'

afterEach(() => vi.unstubAllEnvs())

describe('audit date-time input', () => {
  it.each(['utc', 'local'] as const)(
    'preserves an exact instant on untouched Apply in %s mode',
    (mode) => {
      const instant = '2026-09-24T12:04:55.123Z'
      expect(parseInputInstant(formatInputInstant(instant, mode), mode)).toBe(instant)
    }
  )

  it('accepts native minute input as an exact zero-second instant', () => {
    expect(parseInputInstant('2026-09-24T12:04', 'utc')).toBe('2026-09-24T12:04:00.000Z')
  })

  it('rejects nonexistent and repeated wall times during New York clock changes', () => {
    vi.stubEnv('TZ', 'America/New_York')
    expect(parseInputInstant('2026-03-08T02:30:00', 'local')).toBeNull()
    expect(parseInputInstant('2026-11-01T01:30:00', 'local')).toBeNull()
    expect(parseInputInstant('2026-11-01T03:30:00', 'local')).toBe('2026-11-01T08:30:00.000Z')
  })
})
