import { notificationFingerprint } from './notification-fingerprint'

describe('notificationFingerprint', () => {
  it('is stable for the same content', () => {
    const a = notificationFingerprint('account.x', 1, { a: 1, b: 'two' })
    const b = notificationFingerprint('account.x', 1, { a: 1, b: 'two' })

    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is independent of object key order', () => {
    expect(notificationFingerprint('t', 1, { a: 1, b: 2 })).toBe(
      notificationFingerprint('t', 1, { b: 2, a: 1 })
    )
  })

  it('differs for different payload, type, or schema version', () => {
    const base = notificationFingerprint('t', 1, { a: 1 })

    expect(notificationFingerprint('t', 1, { a: 2 })).not.toBe(base)
    expect(notificationFingerprint('t2', 1, { a: 1 })).not.toBe(base)
    expect(notificationFingerprint('t', 2, { a: 1 })).not.toBe(base)
  })
})
