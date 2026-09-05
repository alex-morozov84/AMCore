import { describe, expect, it } from 'vitest'

import { registerSchema, supportedLocaleSchema, timezoneSchema } from './auth'

describe('supportedLocaleSchema', () => {
  it('accepts supported locales and rejects others', () => {
    expect(supportedLocaleSchema.safeParse('ru').success).toBe(true)
    expect(supportedLocaleSchema.safeParse('en').success).toBe(true)
    expect(supportedLocaleSchema.safeParse('de').success).toBe(false)
    expect(supportedLocaleSchema.safeParse('EN').success).toBe(false)
  })
})

describe('timezoneSchema', () => {
  it.each(['UTC', 'Europe/Moscow', 'America/New_York', 'US/Eastern'])(
    'accepts the named IANA zone %s',
    (tz) => {
      expect(timezoneSchema.safeParse(tz).success).toBe(true)
    }
  )

  it.each(['+01:00', '-0500', '+23', '-2359'])('rejects the numeric offset %s', (tz) => {
    expect(timezoneSchema.safeParse(tz).success).toBe(false)
  })

  it('rejects an unknown zone name', () => {
    expect(timezoneSchema.safeParse('Mars/Phobos').success).toBe(false)
  })
})

/**
 * `name` is `optional()` — that means the field may be omitted, not that an
 * empty string passes. A consuming form defaulting the field to `''` would
 * otherwise fail this same field's own `min(2)` the moment the form validates
 * on submit. `registerSchema` normalizes a blank string to `undefined` before
 * that check runs (found while writing apps/web's real-stack E2E register
 * flow — silently blocked every registration attempt that left the field
 * untouched).
 */
describe('registerSchema — name', () => {
  const base = { email: 'user@example.com', password: 'Test1234Secure' }

  it('accepts an empty string, treating it the same as omitting the field', () => {
    const result = registerSchema.safeParse({ ...base, name: '' })

    expect(result.success).toBe(true)
    expect(result.success && result.data.name).toBeUndefined()
  })

  it('still rejects a genuinely too-short name', () => {
    const result = registerSchema.safeParse({ ...base, name: 'A' })

    expect(result.success).toBe(false)
  })

  it('still accepts a valid name unchanged', () => {
    const result = registerSchema.safeParse({ ...base, name: 'Jane Doe' })

    expect(result.success).toBe(true)
    expect(result.success && result.data.name).toBe('Jane Doe')
  })

  it('still accepts the field being omitted entirely', () => {
    const result = registerSchema.safeParse(base)

    expect(result.success).toBe(true)
    expect(result.success && result.data.name).toBeUndefined()
  })
})
