import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeByOperationKey } from './path-algebra-operation-dedup.mjs'

function fact(overrides) {
  return { dimension: 'd', path: 'p', operationKey: 'op-a', params: { n: 1 }, ...overrides }
}

test('same key + identical params dedupe to one entry with merged dimensions', () => {
  const result = dedupeByOperationKey([fact({ dimension: 'd1' }), fact({ dimension: 'd2' })])
  assert.equal(result.length, 1)
  assert.deepEqual([...result[0].dimensions].sort(), ['d1', 'd2'])
})

test('param key order does not defeat dedup (canonical comparison)', () => {
  const result = dedupeByOperationKey([
    fact({ params: { a: 1, b: 2 } }),
    fact({ params: { b: 2, a: 1 } }),
  ])
  assert.equal(result.length, 1)
})

test('same key + different params throws structural-params-conflict', () => {
  assert.throws(
    () => dedupeByOperationKey([fact({ params: { n: 1 } }), fact({ params: { n: 2 } })]),
    /structural-params-conflict/
  )
})

test('different keys never collide', () => {
  const result = dedupeByOperationKey([fact({ operationKey: 'op-a' }), fact({ operationKey: 'op-b' })])
  assert.equal(result.length, 2)
})
