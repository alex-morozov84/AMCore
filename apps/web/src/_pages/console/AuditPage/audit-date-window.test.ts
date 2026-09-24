import { describe, expect, it } from 'vitest'

import { auditRangeError, resolveAuditWindow } from './audit-date-window'

const now = Date.parse('2026-09-24T12:00:00.000Z')

describe('audit effective window', () => {
  it('anchors a to-only link to its own end, matching the API', () => {
    expect(resolveAuditWindow({ limit: 50, to: '2026-09-14T12:00:00.000Z' }, now)).toMatchObject({
      from: '2026-09-07T12:00:00.000Z',
      to: '2026-09-14T12:00:00.000Z',
    })
  })

  it('keeps a from-only link if it fits the API window and rejects one that does not', () => {
    expect(resolveAuditWindow({ limit: 50, from: '2026-09-20T12:00:00.000Z' }, now)).toMatchObject({
      from: '2026-09-20T12:00:00.000Z',
      to: '2026-09-24T12:00:00.000Z',
    })
    expect(resolveAuditWindow({ limit: 50, from: '2026-08-01T12:00:00.000Z' }, now)).toBeNull()
  })

  it('distinguishes future and overlong intervals before navigation', () => {
    expect(auditRangeError('2026-09-23T12:00:00Z', '2026-09-25T12:00:00Z', now)).toBe('future')
    expect(auditRangeError('2026-08-01T12:00:00Z', '2026-09-24T12:00:00Z', now)).toBe('tooLong')
  })
})
