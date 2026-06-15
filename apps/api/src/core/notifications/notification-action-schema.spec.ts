import { NOTIFICATION_ACTION_MAX_PARAMS, notificationActionSchema } from '@amcore/shared'

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
