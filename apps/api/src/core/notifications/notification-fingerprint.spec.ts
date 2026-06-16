import { notificationFingerprint } from './notification-fingerprint'

const base = {
  type: 'account.x',
  category: 'account',
  schemaVersion: 1,
  action: null,
  organizationId: null,
  occurredAt: null,
}

describe('notificationFingerprint', () => {
  it('is stable for the same content', () => {
    const a = notificationFingerprint({ ...base, payload: { a: 1, b: 'two' } })
    const b = notificationFingerprint({ ...base, payload: { a: 1, b: 'two' } })

    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is independent of object key order', () => {
    expect(notificationFingerprint({ ...base, payload: { a: 1, b: 2 } })).toBe(
      notificationFingerprint({ ...base, payload: { b: 2, a: 1 } })
    )
  })

  it('differs for different payload, type, or schema version', () => {
    const ref = notificationFingerprint({ ...base, payload: { a: 1 } })

    expect(notificationFingerprint({ ...base, payload: { a: 2 } })).not.toBe(ref)
    expect(notificationFingerprint({ ...base, type: 't2', payload: { a: 1 } })).not.toBe(ref)
    expect(notificationFingerprint({ ...base, schemaVersion: 2, payload: { a: 1 } })).not.toBe(ref)
  })

  it('differs for different organization, explicit event time, or action', () => {
    const ref = notificationFingerprint({ ...base, payload: { a: 1 } })

    expect(
      notificationFingerprint({ ...base, organizationId: 'org-1', payload: { a: 1 } })
    ).not.toBe(ref)
    expect(
      notificationFingerprint({
        ...base,
        occurredAt: '2026-06-15T00:00:00.000Z',
        payload: { a: 1 },
      })
    ).not.toBe(ref)
    expect(
      notificationFingerprint({ ...base, action: { route: 'account.security' }, payload: { a: 1 } })
    ).not.toBe(ref)
  })
})
