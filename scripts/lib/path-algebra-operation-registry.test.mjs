import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'

const stub = { paramsSchema: () => true, deriveSemanticWrites: () => [{ location: 'x', value: 1 }] }

test('define then get returns the same definition', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', stub)
  assert.equal(registry.get('op-a').key, 'op-a')
  assert.equal(registry.has('op-a'), true)
})

test('registering the same operationKey twice throws duplicate-operation-definition', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', stub)
  assert.throws(() => registry.define('op-a', stub), /duplicate-operation-definition/)
})

test('getting an unregistered operationKey throws unknown-operation-key', () => {
  const registry = createOperationRegistry()
  assert.throws(() => registry.get('missing'), /unknown-operation-key/)
})

test('two independently created registries do not share state', () => {
  const first = createOperationRegistry()
  const second = createOperationRegistry()
  first.define('op-a', stub)
  assert.equal(second.has('op-a'), false)
})
