import {
  decodeFeedCursor,
  encodeFeedCursor,
  InvalidFeedCursorError,
} from './notification-feed-cursor'

describe('notification feed cursor', () => {
  it('round-trips a cursor', () => {
    const createdAt = new Date('2026-06-15T12:34:56.000Z')
    const token = encodeFeedCursor({ createdAt, id: 'abc' })

    expect(token.startsWith('v1.')).toBe(true)
    const decoded = decodeFeedCursor(token)
    expect(decoded.id).toBe('abc')
    expect(decoded.createdAt.toISOString()).toBe('2026-06-15T12:34:56.000Z')
  })

  it('rejects malformed, mis-versioned, or incomplete cursors', () => {
    expect(() => decodeFeedCursor('not-a-cursor')).toThrow(InvalidFeedCursorError)
    expect(() => decodeFeedCursor('v2.eyJjIjoieCJ9')).toThrow(InvalidFeedCursorError)
    expect(() => decodeFeedCursor('v1.@@@notbase64@@@')).toThrow(InvalidFeedCursorError)
    expect(() =>
      decodeFeedCursor(`v1.${Buffer.from(JSON.stringify({ i: 'x' })).toString('base64url')}`)
    ).toThrow(InvalidFeedCursorError)
    expect(() =>
      decodeFeedCursor(
        `v1.${Buffer.from(JSON.stringify({ c: 'not-a-date', i: 'x' })).toString('base64url')}`
      )
    ).toThrow(InvalidFeedCursorError)
  })

  it('rejects empty or oversized ids and unexpected payload fields', () => {
    const token = (payload: object): string =>
      `v1.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
    const createdAt = '2026-06-15T12:34:56.000Z'

    expect(() => decodeFeedCursor(token({ c: createdAt, i: '' }))).toThrow(InvalidFeedCursorError)
    expect(() => decodeFeedCursor(token({ c: createdAt, i: 'x'.repeat(65) }))).toThrow(
      InvalidFeedCursorError
    )
    expect(() => decodeFeedCursor(token({ c: createdAt, i: 'x', extra: true }))).toThrow(
      InvalidFeedCursorError
    )
  })
})
