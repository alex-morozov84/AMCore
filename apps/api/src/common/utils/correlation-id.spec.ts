import { isCorrelationId, pickCorrelationId } from './correlation-id'

describe('correlation ID', () => {
  const generate = () => 'generated-id'

  it.each(['abc', '0b6f6d1e-6c4d-4a52-9f5b-2f6c3e1a9d10', 'req_1.2:3-x', 'a'.repeat(128)])(
    'accepts %s',
    (value) => {
      expect(isCorrelationId(value)).toBe(true)
    }
  )

  it.each(['', 'a'.repeat(129), 'has space', 'new\nline', 'semi;colon', 'ünïcode', '<script>'])(
    'rejects %j',
    (value) => {
      expect(isCorrelationId(value)).toBe(false)
    }
  )

  it('rejects non-strings and repeated headers', () => {
    expect(isCorrelationId(undefined)).toBe(false)
    expect(isCorrelationId(['a', 'b'])).toBe(false)
  })

  it('uses the first well-formed header in priority order', () => {
    expect(pickCorrelationId(['req-1', 'corr-2'], generate)).toBe('req-1')
    expect(pickCorrelationId([undefined, 'corr-2'], generate)).toBe('corr-2')
    expect(pickCorrelationId(['bad value', 'corr-2'], generate)).toBe('corr-2')
  })

  it('generates an ID when nothing usable arrives', () => {
    expect(pickCorrelationId([undefined, undefined], generate)).toBe('generated-id')
    expect(pickCorrelationId([['a', 'b'], 'x'.repeat(200)], generate)).toBe('generated-id')
  })
})
