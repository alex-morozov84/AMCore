import { describe, expect, it } from 'vitest'

import {
  NOTIFICATION_ACTION_MAX_PARAMS,
  notificationActionSchema,
  notificationSseEventSchema,
} from './notifications'

/**
 * Contract tests for the shared notification action descriptor. The action is a
 * durable/wire boundary later interpreted by a client, so the grammar must be a
 * real control — not a prose assertion (ADR-052).
 */
describe('notificationActionSchema', () => {
  it('accepts a dotted route key with bounded params', () => {
    const result = notificationActionSchema.safeParse({
      route: 'account.security',
      params: { tab: 'sessions' },
    })

    expect(result.success).toBe(true)
  })

  it('accepts a route without params', () => {
    expect(notificationActionSchema.safeParse({ route: 'account' }).success).toBe(true)
  })

  it('rejects an arbitrary URL as the route', () => {
    expect(notificationActionSchema.safeParse({ route: 'https://evil.example' }).success).toBe(
      false
    )
    expect(notificationActionSchema.safeParse({ route: 'foo/bar' }).success).toBe(false)
    expect(notificationActionSchema.safeParse({ route: '../escape' }).success).toBe(false)
  })

  it('rejects oversized param values and bad param keys', () => {
    expect(
      notificationActionSchema.safeParse({ route: 'a', params: { k: 'x'.repeat(257) } }).success
    ).toBe(false)
    expect(
      notificationActionSchema.safeParse({ route: 'a', params: { 'Bad Key': 'v' } }).success
    ).toBe(false)
  })

  it('rejects too many params', () => {
    const params = Object.fromEntries(
      Array.from({ length: NOTIFICATION_ACTION_MAX_PARAMS + 1 }, (_, i) => [`k${i}`, 'v'])
    )

    expect(notificationActionSchema.safeParse({ route: 'a', params }).success).toBe(false)
  })
})

/**
 * `notificationSseEventSchema` is the public SSE hint contract. `apps/api`'s
 * internal Redis Pub/Sub envelope (`notificationRealtimeEnvelopeSchema`)
 * extends it and is tested there — it is not a client-facing schema and never
 * lives in this package (ADR-053).
 */
describe('notificationSseEventSchema (public hint)', () => {
  const valid = { eventId: 'evt_1', reason: 'created', notificationId: 'ntf_1' }

  it('accepts an aggregate hint without notificationId', () => {
    expect(
      notificationSseEventSchema.parse({ eventId: 'evt_1', reason: 'unread_changed' })
    ).toEqual({
      eventId: 'evt_1',
      reason: 'unread_changed',
    })
  })

  it('rejects an unknown reason (e.g. the unadopted "read-all")', () => {
    expect(notificationSseEventSchema.safeParse({ ...valid, reason: 'read-all' }).success).toBe(
      false
    )
  })

  it('rejects extra fields (.strict)', () => {
    expect(notificationSseEventSchema.safeParse({ ...valid, recipientUserId: 'u1' }).success).toBe(
      false
    )
  })

  it('rejects an over-long eventId', () => {
    expect(
      notificationSseEventSchema.safeParse({ ...valid, eventId: 'x'.repeat(65) }).success
    ).toBe(false)
  })

  it('rejects an empty notificationId', () => {
    expect(notificationSseEventSchema.safeParse({ ...valid, notificationId: '' }).success).toBe(
      false
    )
  })
})
