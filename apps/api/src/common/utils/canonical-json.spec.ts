import { canonicalJson, canonicalJsonEqual, canonicalJsonHash } from './canonical-json'

describe('canonicalJson', () => {
  it('ignores object key order at every depth but keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, 1] } })).toBe(
      canonicalJson({ a: { c: [3, 1], d: 2 }, b: 1 })
    )
    expect(canonicalJsonEqual([1, 2], [2, 1])).toBe(false)
  })

  it('drops undefined members and distinguishes differing values', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }))
    expect(canonicalJsonEqual({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('hashes equal values equally and different values differently', () => {
    expect(canonicalJsonHash({ x: 1, y: 2 })).toBe(canonicalJsonHash({ y: 2, x: 1 }))
    expect(canonicalJsonHash({ x: 1 })).not.toBe(canonicalJsonHash({ x: 2 }))
    expect(canonicalJsonHash({ x: 1 })).toMatch(/^[0-9a-f]{64}$/)
  })
})
