import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { conflict, stubDefinition } from './path-algebra-test-helpers.mjs'

const invalidDefinition = conflict(CONFLICT_CODES.INVALID_OPERATION_DEFINITION)

test('define then get returns the same definition, with dependsOn defaulted', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', stubDefinition())
  assert.equal(registry.get('op-a').key, 'op-a')
  assert.deepEqual(registry.get('op-a').dependsOn, [])
  assert.equal(registry.has('op-a'), true)
})

test('registering the same operationKey twice throws duplicate-operation-definition', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', stubDefinition())
  assert.throws(() => registry.define('op-a', stubDefinition()), /duplicate-operation-definition/)
})

test('getting an unregistered operationKey throws unknown-operation-key', () => {
  const registry = createOperationRegistry()
  assert.throws(() => registry.get('missing'), /unknown-operation-key/)
})

test('two independently created registries do not share state', () => {
  const first = createOperationRegistry()
  const second = createOperationRegistry()
  first.define('op-a', stubDefinition())
  assert.equal(second.has('op-a'), false)
})

test('a malformed operationKey is rejected at definition time', () => {
  const registry = createOperationRegistry()
  assert.throws(() => registry.define('', stubDefinition()), invalidDefinition)
  assert.throws(() => registry.define(undefined, stubDefinition()), invalidDefinition)
})

test('a definition that is not an object is rejected', () => {
  const registry = createOperationRegistry()
  assert.throws(() => registry.define('op-a', null), invalidDefinition)
  assert.throws(() => registry.define('op-a', 'not-a-definition'), invalidDefinition)
})

for (const field of ['paramsSchema', 'deriveSemanticWrites', 'adapter']) {
  test(`a definition missing "${field}" (or with a non-function) is rejected and names the field`, () => {
    const registry = createOperationRegistry()
    assert.throws(
      () => registry.define('op-a', stubDefinition({ [field]: undefined })),
      invalidDefinition
    )
    assert.throws(
      () => registry.define('op-a', stubDefinition({ [field]: 'not-a-function' })),
      (error) => invalidDefinition(error) && error.message.includes(`"${field}"`)
    )
    assert.equal(registry.has('op-a'), false)
  })
}

test('dependsOn must be an array of non-empty strings', () => {
  const registry = createOperationRegistry()
  assert.throws(
    () => registry.define('op-a', stubDefinition({ dependsOn: 'op-b' })),
    invalidDefinition
  )
  assert.throws(
    () => registry.define('op-a', stubDefinition({ dependsOn: [''] })),
    invalidDefinition
  )
  assert.throws(
    () => registry.define('op-a', stubDefinition({ dependsOn: [42] })),
    invalidDefinition
  )
})

test('an operation may not depend on itself', () => {
  const registry = createOperationRegistry()
  assert.throws(
    () => registry.define('op-a', stubDefinition({ dependsOn: ['op-a'] })),
    invalidDefinition
  )
})

test('a rejected definition leaves the key unregistered, so a corrected define succeeds', () => {
  const registry = createOperationRegistry()
  assert.throws(
    () => registry.define('op-a', stubDefinition({ adapter: undefined })),
    invalidDefinition
  )
  registry.define('op-a', stubDefinition())
  assert.equal(registry.has('op-a'), true)
})
