import { BadRequestException } from '../../common/exceptions'

import { AuditCursorCodec } from './audit-cursor'

const scope = {
  operatorId: 'operator1',
  from: '2026-09-16T00:00:00.000Z',
  to: '2026-09-23T00:00:00.000Z',
  filters: { actorId: 'actor1' },
}
const key = '00000000-0000-4000-8000-000000000003'

describe('private audit cursor', () => {
  const codec = new AuditCursorCodec('a-test-secret-at-least-32-characters-long')

  it('keeps the raw primary ID out of a fixed-size URL token', () => {
    const hostileId = 'private-id/' + 'x'.repeat(10_000)
    const token = codec.seal(key, scope)
    expect(token.length).toBeLessThanOrEqual(512)
    expect(token).not.toContain(hostileId)
    expect(codec.open(token, scope)).toBe(key)
  })

  it('rejects tampering, wrong operator/filter/window and oversized encodings', () => {
    const token = codec.seal(key, scope)
    for (const [value, context] of [
      [token + '!', scope],
      [token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), scope],
      [token, { ...scope, operatorId: 'other' }],
      [token, { ...scope, filters: { actorId: 'other' } }],
      [token, { ...scope, filters: { actorId: 'actor1', includeReadEvents: true } }],
      [token, { ...scope, from: '2026-09-15T00:00:00.000Z' }],
      ['x'.repeat(513), scope],
    ] as const)
      expect(() => codec.open(value, context)).toThrow(BadRequestException)
  })
})
