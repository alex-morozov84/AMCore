import { z } from 'zod'

import { canonicalValue, decodeSetting, encodeSetting, immutable } from './setting-codec'
import { testDefinition } from './setting-definition.fixture'
import { SettingRegistry } from './setting-registry'

describe('ordinary typed setting definitions', () => {
  it.each([
    ['test.string', z.string().max(100), 'email.example.test', 'model.example'],
    ['test.boolean', z.boolean(), false, true],
    ['test.nullable', z.string().nullable(), 'baseline', null],
  ] as const)('reuses the same codec and registry for %s', (key, schema, baseline, value) => {
    const d = testDefinition<unknown>(key, schema, baseline)
    const registry = new SettingRegistry([d])
    registry.assert(d)
    expect(
      decodeSetting(d, { key, schemaVersion: 1, revision: 1, override: encodeSetting(d, value) })
    ).toEqual(value)
    expect(decodeSetting(d, { key, schemaVersion: 1, revision: 2, override: null })).toBeUndefined()
  })
  it('rejects unknown versions, malformed envelopes, oversized payloads and secret definitions', () => {
    const d = testDefinition('test.string', z.string(), '')
    expect(() => encodeSetting(d, 'a'.repeat(16_384))).toThrow()
    expect(() =>
      decodeSetting(d, { key: d.key, schemaVersion: 2, revision: 0, override: null })
    ).toThrow()
    expect(() =>
      decodeSetting(d, {
        key: d.key,
        schemaVersion: 1,
        revision: 0,
        override: { value: '', extra: true },
      })
    ).toThrow()
    expect(
      () => new SettingRegistry([{ ...d, storageKind: 'secret' } as unknown as typeof d])
    ).toThrow()
    expect(() => new SettingRegistry([d, d])).toThrow()
    expect(() => new SettingRegistry([{ ...d, baseline: () => 'a'.repeat(16_384) }])).toThrow()
  })
  it('compares object values canonically and isolates nested immutable snapshots', () => {
    expect(canonicalValue({ b: 1, a: [null, false] })).toBe(
      canonicalValue({ a: [null, false], b: 1 })
    )
    const original = { nested: { value: true } }
    const copy = immutable(original)
    original.nested.value = false
    expect(copy.nested.value).toBe(true)
    expect(Object.isFrozen(copy.nested)).toBe(true)
  })
  it('counts UTF-8 bytes rather than characters at the serialized envelope boundary', () => {
    const d = testDefinition('test.utf8', z.string(), '')
    expect(Buffer.byteLength(JSON.stringify(encodeSetting(d, 'Ж'.repeat(8186))), 'utf8')).toBe(
      16_384
    )
    expect(() => encodeSetting(d, 'Ж'.repeat(8187))).toThrow()
  })
})
