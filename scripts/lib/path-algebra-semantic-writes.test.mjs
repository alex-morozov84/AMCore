import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { deriveSemanticWrites, assertNoSemanticWriteConflicts } from './path-algebra-semantic-writes.mjs'

function dedupedFact(operationKey, dimensions = ['d']) {
  return { path: 'p', operationKey, dimensions: new Set(dimensions) }
}

test('deriveSemanticWrites throws empty-semantic-writes when the definition returns none', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', { paramsSchema: () => true, deriveSemanticWrites: () => [] })
  assert.throws(
    () => deriveSemanticWrites(registry, { ...dedupedFact('op-a'), params: {} }),
    /empty-semantic-writes/
  )
})

test('different semantic locations on the same file compose without conflict', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', { paramsSchema: () => true, deriveSemanticWrites: () => [{ location: 'loc-a', value: 1 }] })
  registry.define('op-b', { paramsSchema: () => true, deriveSemanticWrites: () => [{ location: 'loc-b', value: 2 }] })
  const facts = [dedupedFact('op-a'), dedupedFact('op-b')]
  const writesByKey = new Map(facts.map((f) => [f.operationKey, deriveSemanticWrites(registry, { ...f, params: {} })]))
  assert.doesNotThrow(() => assertNoSemanticWriteConflicts(facts, writesByKey))
})

test('same location + same value from different keys is compatible', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', { paramsSchema: () => true, deriveSemanticWrites: () => [{ location: 'loc', value: 'v' }] })
  registry.define('op-b', { paramsSchema: () => true, deriveSemanticWrites: () => [{ location: 'loc', value: 'v' }] })
  const facts = [dedupedFact('op-a'), dedupedFact('op-b')]
  const writesByKey = new Map(facts.map((f) => [f.operationKey, deriveSemanticWrites(registry, { ...f, params: {} })]))
  assert.doesNotThrow(() => assertNoSemanticWriteConflicts(facts, writesByKey))
})

test('same location + different values from different keys conflicts even though each parses fine alone', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', { paramsSchema: () => true, deriveSemanticWrites: () => [{ location: 'loc', value: 'v1' }] })
  registry.define('op-b', { paramsSchema: () => true, deriveSemanticWrites: () => [{ location: 'loc', value: 'v2' }] })
  const facts = [dedupedFact('op-a'), dedupedFact('op-b')]
  const writesByKey = new Map(facts.map((f) => [f.operationKey, deriveSemanticWrites(registry, { ...f, params: {} })]))
  assert.throws(() => assertNoSemanticWriteConflicts(facts, writesByKey), /semantic-write-conflict/)
})
