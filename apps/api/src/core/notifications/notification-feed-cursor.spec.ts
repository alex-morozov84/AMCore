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
})
