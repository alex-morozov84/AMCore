import type { Queue } from 'bullmq'
import { z } from 'zod'

import { ManagedProducer } from './managed-producer'
import { defineOrdinaryWork } from './work-definition'
import { canonicalWire, parseWorkPayload, wireJson } from './work-payload'
import { WorkReadiness } from './work-readiness'

const version = { wireVersion: 1, schema: z.object({ input: z.number() }) }

describe('canonical wire and normalization boundary', () => {
  it('strips explicitly, normalizes once and leaves wire untouched', () => {
    const binding = {
      ...version,
      normalize: (wire: { input: number }) => ({ output: wire.input + 1 }),
    }
    const wire = canonicalWire(binding, { input: 4, secret: 'stripped' })
    expect(wire).toEqual({ input: 4 })
    expect(parseWorkPayload(binding, wire)).toEqual({ output: 5 })
    expect(wire).toEqual({ input: 4 })
    expect(() => parseWorkPayload(binding, { input: 4, secret: 'not canonical' })).toThrow()
  })

  it('retains explicit passthrough, strict and stable canonicalization', () => {
    const pass = { wireVersion: 1, schema: z.object({ input: z.number() }).passthrough() }
    expect(canonicalWire(pass, { input: 1, extra: 'kept' })).toEqual({ input: 1, extra: 'kept' })
    expect(() =>
      canonicalWire({ ...version, schema: version.schema.strict() }, { input: 1, extra: 1 })
    ).toThrow()
    expect(canonicalWire({ wireVersion: 1, schema: z.string().trim() }, ' wire ')).toBe('wire')
    expect(() =>
      canonicalWire({ wireVersion: 1, schema: z.number().transform((n) => n + 1) }, 1)
    ).toThrow()
  })

  it('refuses throwing, mutating, async and promise-returning normalizers', () => {
    const wire = { input: 1 }
    const callbacks = [
      () => {
        throw new Error('business failure')
      },
      (value: { input: number }) => {
        value.input++
        return value
      },
      async () => ({}),
      () => Promise.reject(new Error('async failure')),
    ]
    for (const normalize of callbacks)
      expect(() => parseWorkPayload({ ...version, normalize }, wire)).toThrow()
    expect(wire).toEqual({ input: 1 })
  })

  it('refuses JSON coercion, accessors, sparse arrays, cycles and nonplain values', () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const getter = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        throw new Error('must not run')
      },
    })
    const cases = [
      undefined,
      NaN,
      Infinity,
      -0,
      BigInt(1),
      () => 1,
      Symbol('x'),
      new Date(),
      new Map(),
      { missing: undefined },
      [undefined],
      Array(1),
      cycle,
      getter,
      { toJSON: () => ({}) },
    ]
    for (const value of cases) expect(() => wireJson(value)).toThrow()
    const shared = { value: 1 }
    expect(JSON.parse(wireJson({ a: shared, b: shared }))).toEqual({ a: shared, b: shared })
  })

  it('bounds encoded Unicode/escaping, nodes and depth', () => {
    expect(Buffer.byteLength(wireJson('x'.repeat(32766)))).toBe(32768)
    expect(() => wireJson('x'.repeat(32767))).toThrow()
    expect(() => wireJson('я'.repeat(16384))).toThrow()
    expect(() => wireJson('"'.repeat(16384))).toThrow()
    expect(() => wireJson(Array(32769).fill(null))).toThrow()
    let deep: unknown = null
    for (let index = 0; index < 65; index++) deep = { child: deep }
    expect(() => wireJson(deep)).toThrow()
  })

  it.each(['4294967295', '9007199254740993'])('refuses a missing index masked by %s', (key) => {
    const items = Array(1)
    Object.defineProperty(items, key, { enumerable: true, value: 'lost business value' })
    expect(() => wireJson(items)).toThrow('CONTENT_UNSUPPORTED')
    expect(() => canonicalWire({ wireVersion: 1, schema: z.unknown() }, items)).toThrow(
      'CONTENT_UNSUPPORTED'
    )
    expect(() =>
      canonicalWire({ wireVersion: 1, schema: z.strictObject({ items: z.unknown() }) }, { items })
    ).toThrow('CONTENT_UNSUPPORTED')
    expect(() =>
      canonicalWire({ wireVersion: 1, schema: z.object({}).passthrough() }, { items })
    ).toThrow('CONTENT_UNSUPPORTED')
  })

  it.each([{ items: [] }, { items: [null] }, { items: [0, false, 'я', { nested: [1, null] }] }])(
    'preserves dense array $items',
    ({ items }) => {
      expect(JSON.parse(wireJson(items))).toEqual(items)
      expect(canonicalWire({ wireVersion: 1, schema: z.unknown() }, items)).toEqual(items)
    }
  )

  it('continues to refuse sparse, undefined, accessor, symbol and extra-property arrays', () => {
    const getter = jest.fn(() => 'must not read')
    const accessor = Object.defineProperty(Array(1), '0', { enumerable: true, get: getter })
    const symbol = Object.assign([null], { [Symbol('extra')]: 'lost' })
    const extra = Object.assign([null], { extra: 'lost' })
    const masked = Object.assign(Array(1), { '01': 'lost' })
    for (const items of [Array(1), [undefined], accessor, symbol, extra, masked]) {
      expect(() => wireJson(items)).toThrow('CONTENT_UNSUPPORTED')
      expect(() => canonicalWire({ wireVersion: 1, schema: z.unknown() }, items)).toThrow(
        'CONTENT_UNSUPPORTED'
      )
    }
    expect(getter).not.toHaveBeenCalled()
  })

  it.each(['4294967295', '9007199254740993'])(
    'rejects producer input %s before backend acquisition and writes',
    async (key) => {
      const items = Array(1)
      Object.defineProperty(items, key, { enumerable: true, value: 'lost business value' })
      const initialize = jest.fn()
      const getBackend = jest.fn(() => ({ client: Promise.resolve({ eval: initialize }) }))
      const add = jest.fn()
      const queue = { getBackend, add } as unknown as Queue
      const readiness = new WorkReadiness()
      readiness.open()
      const schemas = [
        z.unknown(),
        z.strictObject({ items: z.unknown() }),
        z.object({}).passthrough(),
      ]
      for (const schema of schemas) {
        const definition = defineOrdinaryWork({
          id: 'array-proof',
          definitionVersion: 1,
          queue: { name: 'array-proof', enabled: true },
          jobs: {
            run: {
              wireVersion: 1,
              schema,
              replay: { kind: 'idempotent', policyVersion: 1 },
              project: () => ({}),
              retention: { completedMs: 1000, failedMs: 1000 },
            },
          },
        })
        const payload = schema === schemas[0] ? items : { items }
        await expect(
          new ManagedProducer(definition, queue, readiness).add('run', payload)
        ).rejects.toThrow('CONTENT_UNSUPPORTED')
      }
      expect(getBackend).not.toHaveBeenCalled()
      expect(initialize).not.toHaveBeenCalled()
      expect(add).not.toHaveBeenCalled()
    }
  )
})
