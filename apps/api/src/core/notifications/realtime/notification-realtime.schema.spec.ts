import { notificationRealtimeEnvelopeSchema } from './notification-realtime.schema'

/**
 * `notificationSseEventSchema`, the public schema this envelope extends, is
 * tested in `packages/shared/src/schemas/notifications.test.ts`. Only the
 * envelope's own additions (`v`, `recipientUserId`, `.strict()`) are covered
 * here.
 */
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
