import { describe, expect, it } from 'vitest'

import { adminSessionIdSchema, adminSessionSchema, adminSessionsQuerySchema } from './admin-session'
import { sessionSchema } from './auth'

const timestamp = '2026-09-26T12:00:00.000Z'
const fields = {
  userAgent: null,
  ipAddress: null,
  location: null,
  createdAt: timestamp,
  expiresAt: timestamp,
}

describe('Session public schemas', () => {
  it('accepts unavailable metadata in admin and own-session projections', () => {
    expect(
      adminSessionSchema.safeParse({ ...fields, sessionId: 'a'.repeat(32), lastAuthAt: null })
        .success
    ).toBe(true)
    expect(sessionSchema.safeParse({ ...fields, id: 'row-id', current: true }).success).toBe(true)
  })

  it('accepts partial city information and rejects malformed location', () => {
    const session = { ...fields, sessionId: 'b'.repeat(32), lastAuthAt: timestamp }
    expect(
      adminSessionSchema.safeParse({ ...session, location: { city: null, countryCode: 'GB' } })
        .success
    ).toBe(true)
    expect(
      adminSessionSchema.safeParse({
        ...session,
        location: { city: 'London', countryCode: 'invalid' },
      }).success
    ).toBe(false)
  })

  it('requires the noncredential family shape without overriding localized parse errors', () => {
    expect(adminSessionIdSchema.safeParse('a'.repeat(32)).success).toBe(true)
    const invalid = adminSessionIdSchema.safeParse('physical-row-id', { error: () => 'localized' })
    expect(invalid.success).toBe(false)
    if (!invalid.success) expect(invalid.error.issues[0].message).toBe('localized')
  })

  it('rejects invalid pagination before service access', () => {
    expect(adminSessionsQuerySchema.safeParse({ page: '0', limit: '20' }).success).toBe(false)
    expect(adminSessionsQuerySchema.safeParse({ page: '1', limit: '10001' }).success).toBe(false)
    expect(adminSessionsQuerySchema.parse({ page: '2', limit: '20' })).toEqual({
      page: 2,
      limit: 20,
    })
  })
})
