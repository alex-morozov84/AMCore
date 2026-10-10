import { z } from 'zod'

import { canonicalJsonEqual } from '@/common/utils/canonical-json'

/** Bounded wire representation only; normalized business values are never serialized here. */
export function wireJson(value: unknown): string {
  const pending: { value: unknown; depth: number; leave?: boolean }[] = [{ value, depth: 0 }]
  const seen = new Set<object>()
  let remaining = 32768
  while (pending.length) {
    const item = pending.pop()!
    if (item.leave) {
      seen.delete(item.value as object)
      continue
    }
    if (--remaining < 0 || item.depth > 64) throw new Error('CONTENT_UNSUPPORTED')
    const node = item.value
    if (node === null || typeof node === 'boolean') continue
    if (typeof node === 'string') {
      if (Buffer.byteLength(node) > 32768) throw new Error('CONTENT_UNSUPPORTED')
      continue
    }
    if (typeof node === 'number' && Number.isFinite(node) && !Object.is(node, -0)) continue
    if (typeof node !== 'object' || seen.has(node)) throw new Error('CONTENT_UNSUPPORTED')
    seen.add(node)
    pending.push({ value: node, depth: item.depth, leave: true })
    const array = Array.isArray(node)
    if (
      array
        ? Object.getPrototypeOf(node) !== Array.prototype
        : Object.getPrototypeOf(node) !== Object.prototype && Object.getPrototypeOf(node) !== null
    )
      throw new Error('CONTENT_UNSUPPORTED')
    const keys = Reflect.ownKeys(node)
    if (keys.length > remaining || (array && keys.length !== node.length + 1))
      throw new Error('CONTENT_UNSUPPORTED')
    for (const key of keys) {
      if (array && key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(node, key)!
      if (
        typeof key !== 'string' ||
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        Buffer.byteLength(key) > 32768 ||
        (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= node.length))
      )
        throw new Error('CONTENT_UNSUPPORTED')
      pending.push({ value: descriptor.value, depth: item.depth + 1 })
    }
  }
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text) > 32768 || !canonicalJsonEqual(value, JSON.parse(text)))
    throw new Error('CONTENT_UNSUPPORTED')
  return text
}

export interface PayloadVersion<S extends z.ZodType = z.ZodType, P = z.output<S>> {
  readonly wireVersion: number
  readonly schema: S
  normalize?(wire: z.output<S>): P
}

/** Schema cleaning is explicit; its canonical output must remain stable on wire replay. */
export function canonicalWire(version: PayloadVersion, input: unknown): unknown {
  const wire = version.schema.parse(input)
  const text = wireJson(wire)
  const decoded: unknown = JSON.parse(text)
  const replayed = version.schema.parse(JSON.parse(text))
  wireJson(replayed)
  if (!canonicalJsonEqual(decoded, replayed)) throw new Error('CONTENT_UNSUPPORTED')
  return decoded
}

/** Consumers reject corrupt/noncanonical stored data and share the same normalization boundary. */
export function parseWorkPayload(version: PayloadVersion, stored: unknown): unknown {
  const text = wireJson(stored)
  const wire = canonicalWire(version, JSON.parse(text))
  if (!canonicalJsonEqual(stored, wire)) throw new Error('CONTENT_UNSUPPORTED')
  const copy: unknown = JSON.parse(text)
  const pending = [copy]
  while (pending.length) {
    const value = pending.pop()
    if (value && typeof value === 'object') {
      pending.push(...Object.values(value))
      Object.freeze(value)
    }
  }
  if (version.normalize?.constructor.name === 'AsyncFunction')
    throw new Error('CONTENT_UNSUPPORTED')
  const payload = version.normalize ? version.normalize(copy) : copy
  if (
    payload &&
    (typeof payload === 'object' || typeof payload === 'function') &&
    'then' in payload &&
    typeof payload.then === 'function'
  ) {
    if (payload instanceof Promise) void payload.catch(() => undefined)
    throw new Error('CONTENT_UNSUPPORTED')
  }
  return payload
}
