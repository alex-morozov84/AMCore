import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { orderOperationKeys } from './path-algebra-operation-order.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { conflict, stubDefinition } from './path-algebra-test-helpers.mjs'

function registryWith(defs) {
  const registry = createOperationRegistry()
  for (const [key, dependsOn] of defs) registry.define(key, stubDefinition({ dependsOn }))
  return registry
}

test('a dependency that is registered but not in this composition throws missing-operation-dependency', () => {
  const registry = registryWith([
    ['op-a', ['op-b']],
    ['op-b', []],
  ])
  assert.throws(
    () => orderOperationKeys(registry, ['op-a']),
    conflict(CONFLICT_CODES.MISSING_OPERATION_DEPENDENCY)
  )
})

test('a dependency that was never registered throws unknown-operation-dependency, naming both keys', () => {
  const registry = registryWith([['op-a', ['op-never-defined']]])
  assert.throws(
    () => orderOperationKeys(registry, ['op-a']),
    (error) =>
      conflict(CONFLICT_CODES.UNKNOWN_OPERATION_DEPENDENCY)(error) &&
      error.message.includes('"op-a"') &&
      error.message.includes('"op-never-defined"')
  )
})

test('a dependency cycle throws operation-dependency-cycle', () => {
  const registry = registryWith([
    ['op-a', ['op-b']],
    ['op-b', ['op-a']],
  ])
  assert.throws(() => orderOperationKeys(registry, ['op-a', 'op-b']), /operation-dependency-cycle/)
})

test('op-a depends on op-b: op-b always precedes op-a, regardless of input order', () => {
  const registry = registryWith([
    ['op-a', ['op-b']],
    ['op-b', []],
  ])
  assert.deepEqual(orderOperationKeys(registry, ['op-a', 'op-b']), ['op-b', 'op-a'])
  assert.deepEqual(orderOperationKeys(registry, ['op-b', 'op-a']), ['op-b', 'op-a'])
})

test('keys with no dependency order lexicographically regardless of registration order', () => {
  const registryInOrder = registryWith([
    ['op-c', []],
    ['op-a', []],
    ['op-b', []],
  ])
  const registryReversed = registryWith([
    ['op-b', []],
    ['op-a', []],
    ['op-c', []],
  ])
  const expected = ['op-a', 'op-b', 'op-c']
  assert.deepEqual(orderOperationKeys(registryInOrder, ['op-c', 'op-a', 'op-b']), expected)
  assert.deepEqual(orderOperationKeys(registryReversed, ['op-b', 'op-c', 'op-a']), expected)
})
