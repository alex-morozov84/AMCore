import { canonicalJson } from './canonical-json'

/** Validate the JSON domain before canonicalization can discard or coerce values. */
export function strictJson(value: unknown, maxBytes: number, maxDepth = 20): string {
  const ancestors = new Set<object>()
  const visit = (item: unknown, depth: number): void => {
    if (depth > maxDepth) throw new Error('json_depth_exceeded')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (!item || typeof item !== 'object' || ancestors.has(item)) throw new Error('invalid_json')
    const prototype = Object.getPrototypeOf(item)
    if (Array.isArray(item) ? prototype !== Array.prototype : prototype !== Object.prototype) {
      throw new Error('invalid_json_object')
    }
    ancestors.add(item)
    if (Object.getOwnPropertySymbols(item).length) throw new Error('invalid_json_symbol')
    const descriptors = Object.getOwnPropertyDescriptors(item)
    if (Array.isArray(item)) {
      if (
        Object.keys(item).length !== item.length ||
        Object.getOwnPropertyNames(item).length !== item.length + 1
      )
        throw new Error('invalid_json_array')
      for (let index = 0; index < item.length; index++) {
        const descriptor = descriptors[String(index)]
        if (!descriptor || !('value' in descriptor)) throw new Error('invalid_json_accessor')
        visit(descriptor.value, depth + 1)
      }
    } else {
      for (const descriptor of Object.values(descriptors)) {
        if (!descriptor.enumerable || !('value' in descriptor))
          throw new Error('invalid_json_accessor')
        visit(descriptor.value, depth + 1)
      }
    }
    ancestors.delete(item)
  }
  visit(value, 0)
  const serialized = canonicalJson(value)
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new Error('json_size_exceeded')
  return serialized
}
