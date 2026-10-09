import { strictJson } from './strict-json'

describe('durable intent JSON boundary', () => {
  it.each([undefined, NaN, Infinity, new Date(), new Map(), () => null, BigInt(1)])(
    'rejects lossy values: %s',
    (value) => {
      expect(() => strictJson({ value }, 1024)).toThrow()
    }
  )
  it('rejects sparse arrays, cycles and accessor properties without invoking getters', () => {
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    const getter = jest.fn(() => 'secret')
    const accessor = Object.defineProperty({}, 'value', { get: getter, enumerable: true })
    for (const value of [new Array(2), cycle, accessor]) {
      expect(() => strictJson(value, 1024)).toThrow()
    }
    expect(getter).not.toHaveBeenCalled()
  })
  it('measures UTF-8 bytes and bounds nesting before canonicalization', () => {
    expect(() => strictJson('я', 3)).toThrow('json_size_exceeded')
    expect(() => strictJson({ child: { child: null } }, 1024, 1)).toThrow('json_depth_exceeded')
  })
  it('accepts shared references and produces deterministic JSON without mutating input', () => {
    const shared = { b: true, a: 1 }
    expect(strictJson({ second: shared, first: shared }, 1024)).toBe(
      '{"first":{"a":1,"b":true},"second":{"a":1,"b":true}}'
    )
    expect(Object.keys(shared)).toEqual(['b', 'a'])
  })
})
