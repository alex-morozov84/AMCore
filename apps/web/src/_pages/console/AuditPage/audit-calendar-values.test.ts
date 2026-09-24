import { describe, expect, it } from 'vitest'

import { auditCalendarValues } from './audit-calendar-values'

const now = new Date('2026-09-24T12:34:56.789Z')

describe('audit calendar values', () => {
  it('starts a manually chosen range with whole seconds', () => {
    expect(
      auditCalendarValues(
        new Date('2026-09-20T00:00:00Z'),
        new Date('2026-09-21T00:00:00Z'),
        '2026-09-10T10:15:49.123',
        '2026-09-11T12:30:18.456',
        'utc',
        now
      )
    ).toEqual({ from: '2026-09-20T10:15:00', to: '2026-09-21T12:30:00' })
  })

  it('caps an inherited future end on today and keeps the new value visible', () => {
    expect(
      auditCalendarValues(
        new Date('2026-09-23T00:00:00Z'),
        new Date('2026-09-24T00:00:00Z'),
        '2026-09-10T10:15:49',
        '2026-09-11T18:30:18',
        'utc',
        now
      )
    ).toEqual({ from: '2026-09-23T10:15:00', to: '2026-09-24T12:34:56' })
  })

  it('moves an inherited future start on today to midnight', () => {
    expect(
      auditCalendarValues(
        new Date('2026-09-24T00:00:00Z'),
        new Date('2026-09-24T00:00:00Z'),
        '2026-09-10T18:15:49',
        '2026-09-11T19:30:18',
        'utc',
        now
      )
    ).toEqual({ from: '2026-09-24T00:00:00', to: '2026-09-24T12:34:56' })
  })
})
