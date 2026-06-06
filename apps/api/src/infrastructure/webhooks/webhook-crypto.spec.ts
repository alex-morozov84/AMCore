import { constantTimeEquals, createHmacHex } from './webhook-crypto'

describe('webhook crypto helpers', () => {
  it('creates stable sha256 hex HMAC digests', () => {
    expect(createHmacHex('secret', 'payload')).toHaveLength(64)
    expect(createHmacHex('secret', 'payload')).toBe(createHmacHex('secret', 'payload'))
  })

  it('compares values in constant-time without throwing on different lengths', () => {
    expect(constantTimeEquals('same', 'same')).toBe(true)
    expect(constantTimeEquals('short', 'longer-value')).toBe(false)
  })
})
