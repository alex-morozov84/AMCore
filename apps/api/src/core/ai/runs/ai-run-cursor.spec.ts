import { decodeAiRunCursor, encodeAiRunCursor, InvalidAiRunCursorError } from './ai-run-cursor'

describe('ai-run-cursor', () => {
  it('round-trips a (createdAt, id) cursor', () => {
    const cursor = { createdAt: new Date('2026-06-26T12:34:56.000Z'), id: 'run-123' }
    const decoded = decodeAiRunCursor(encodeAiRunCursor(cursor))

    expect(decoded.id).toBe('run-123')
    expect(decoded.createdAt.toISOString()).toBe('2026-06-26T12:34:56.000Z')
  })

  it.each([
    ['empty', ''],
    ['no version separator', 'abc'],
    ['wrong version', `v2.${Buffer.from('{}').toString('base64url')}`],
    ['non-base64 payload', 'v1.!!!not-base64!!!'],
    [
      'payload missing fields',
      `v1.${Buffer.from('{"c":"2026-06-26T00:00:00.000Z"}').toString('base64url')}`,
    ],
    [
      'payload with extra fields',
      `v1.${Buffer.from('{"c":"2026-06-26T00:00:00.000Z","i":"x","z":1}').toString('base64url')}`,
    ],
  ])('rejects a malformed cursor (%s)', (_label, token) => {
    expect(() => decodeAiRunCursor(token)).toThrow(InvalidAiRunCursorError)
  })
})
