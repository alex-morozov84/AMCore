import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import {
  deriveSemanticWrites,
  assertNoSemanticWriteConflicts,
} from './path-algebra-semantic-writes.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { conflict, stubDefinition } from './path-algebra-test-helpers.mjs'

function dedupedFact(operationKey, dimensions = ['d']) {
  return { path: 'p', operationKey, params: {}, dimensions: new Set(dimensions) }
}

function registryWithWrites(writesByKey) {
  const registry = createOperationRegistry()
  for (const [key, writes] of Object.entries(writesByKey)) {
    registry.define(key, stubDefinition({ deriveSemanticWrites: () => writes }))
  }
  return registry
}

function planWrites(registry, keys) {
  const facts = keys.map((key) => dedupedFact(key))
  const writesByKey = new Map(
    facts.map((fact) => [fact.operationKey, deriveSemanticWrites(registry, fact)])
  )
  return () => assertNoSemanticWriteConflicts(facts, writesByKey)
}

test('deriveSemanticWrites throws empty-semantic-writes when the definition returns none', () => {
  const registry = registryWithWrites({ 'op-a': [] })
  assert.throws(
    () => deriveSemanticWrites(registry, dedupedFact('op-a')),
    conflict(CONFLICT_CODES.EMPTY_SEMANTIC_WRITES)
  )
})

test('a definition returning a non-array is empty-semantic-writes, not a TypeError', () => {
  const registry = registryWithWrites({ 'op-a': { location: 'x', value: 1 } })
  assert.throws(
    () => deriveSemanticWrites(registry, dedupedFact('op-a')),
    conflict(CONFLICT_CODES.EMPTY_SEMANTIC_WRITES)
  )
})

test('each derived claim carries a canonical value, independent of object key order', () => {
  const registry = registryWithWrites({ 'op-a': [{ location: 'loc', value: { b: 2, a: 1 } }] })
  const [claim] = deriveSemanticWrites(registry, dedupedFact('op-a'))
  assert.equal(claim.canonicalValue, '{"a":1,"b":2}')
})

test('different semantic locations on the same file compose without conflict', () => {
  const registry = registryWithWrites({
    'op-a': [{ location: 'loc-a', value: 1 }],
    'op-b': [{ location: 'loc-b', value: 2 }],
  })
  assert.doesNotThrow(planWrites(registry, ['op-a', 'op-b']))
})

test('same location + same value from different keys is compatible', () => {
  const registry = registryWithWrites({
    'op-a': [{ location: 'loc', value: 'v' }],
    'op-b': [{ location: 'loc', value: 'v' }],
  })
  assert.doesNotThrow(planWrites(registry, ['op-a', 'op-b']))
})

test('same location + equal-but-differently-ordered object values from different keys is compatible', () => {
  const registry = registryWithWrites({
    'op-a': [{ location: 'loc', value: { x: 1, y: [1, 2] } }],
    'op-b': [{ location: 'loc', value: { y: [1, 2], x: 1 } }],
  })
  assert.doesNotThrow(planWrites(registry, ['op-a', 'op-b']))
})

test('same location + different values from different keys conflicts even though each parses fine alone', () => {
  const registry = registryWithWrites({
    'op-a': [{ location: 'loc', value: 'v1' }],
    'op-b': [{ location: 'loc', value: 'v2' }],
  })
  assert.throws(
    planWrites(registry, ['op-a', 'op-b']),
    conflict(CONFLICT_CODES.SEMANTIC_WRITE_CONFLICT)
  )
})

test('a cross-key conflict names both operation keys and the location', () => {
  const registry = registryWithWrites({
    'op-a': [{ location: 'loc', value: 'v1' }],
    'op-b': [{ location: 'loc', value: 'v2' }],
  })
  assert.throws(planWrites(registry, ['op-a', 'op-b']), (error) =>
    ['"op-a"', '"op-b"', '"loc"'].every((needle) => error.message.includes(needle))
  )
})
