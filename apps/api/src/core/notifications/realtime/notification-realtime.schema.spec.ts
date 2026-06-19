import { notificationSseEventSchema } from '@amcore/shared'

import { notificationRealtimeEnvelopeSchema } from './notification-realtime.schema'

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

describe('notificationRealtimeEnvelopeSchema (internal)', () => {
  const valid = { v: 1, recipientUserId: 'usr_cuid', eventId: 'evt_1', reason: 'created' }

  it('accepts a valid envelope', () => {
    expect(notificationRealtimeEnvelopeSchema.parse(valid)).toEqual(valid)
  })

  it('inherits the public field bounds (over-long eventId rejected)', () => {
    expect(
      notificationRealtimeEnvelopeSchema.safeParse({ ...valid, eventId: 'x'.repeat(65) }).success
    ).toBe(false)
  })

  it('inherits the public reason set (unknown reason rejected)', () => {
    expect(notificationRealtimeEnvelopeSchema.safeParse({ ...valid, reason: 'nope' }).success).toBe(
      false
    )
  })

  it('rejects a wrong version discriminator', () => {
    expect(notificationRealtimeEnvelopeSchema.safeParse({ ...valid, v: 2 }).success).toBe(false)
  })

  it('rejects a missing recipientUserId', () => {
    expect(
      notificationRealtimeEnvelopeSchema.safeParse({ v: 1, eventId: 'evt_1', reason: 'created' })
        .success
    ).toBe(false)
  })

  it('rejects extra fields (.strict)', () => {
    expect(notificationRealtimeEnvelopeSchema.safeParse({ ...valid, extra: 'x' }).success).toBe(
      false
    )
  })
})
