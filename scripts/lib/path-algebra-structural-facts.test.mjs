import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import {
  validateStructuralFact,
  validateStructuralFacts,
} from './path-algebra-structural-facts.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { conflict, stubDefinition } from './path-algebra-test-helpers.mjs'

const invalidParams = conflict(CONFLICT_CODES.INVALID_OPERATION_PARAMS)

function registryWith(paramsSchema) {
  const registry = createOperationRegistry()
  registry.define('op-a', stubDefinition({ paramsSchema }))
  return registry
}

const rawFact = (overrides = {}) => ({
  dimension: 'd',
  path: 'x',
  operationKey: 'op-a',
  params: {},
  ...overrides,
})

test('validates and normalizes a well-formed structural fact', () => {
  const registry = registryWith(() => true)
  const fact = validateStructuralFact(registry, {
    dimension: 'storybook',
    path: './apps/web/eslint.config.mjs',
    operationKey: 'op-a',
    params: {},
  })
  assert.equal(fact.path, 'apps/web/eslint.config.mjs')
  assert.equal(fact.kind, 'structural')
})

test('unknown operationKey throws unknown-operation-key', () => {
  const registry = createOperationRegistry()
  assert.throws(
    () => validateStructuralFact(registry, rawFact({ operationKey: 'missing' })),
    conflict(CONFLICT_CODES.UNKNOWN_OPERATION_KEY)
  )
})

test('params rejected by paramsSchema throw invalid-operation-params', () => {
  const registry = registryWith(() => false)
  assert.throws(() => validateStructuralFact(registry, rawFact()), invalidParams)
})

test('a paramsSchema that throws becomes a diagnosable invalid-operation-params, keeping its message', () => {
  const registry = registryWith(() => {
    throw new Error('expected "locale" to be a string')
  })
  assert.throws(
    () => validateStructuralFact(registry, rawFact()),
    (error) => invalidParams(error) && error.message.includes('expected "locale" to be a string')
  )
})

test('a paramsSchema that throws a non-Error value is still diagnosed, not rethrown raw', () => {
  const registry = registryWith(() => {
    throw 'bare string'
  })
  assert.throws(() => validateStructuralFact(registry, rawFact()), invalidParams)
})

test('paramsSchema must return exactly true — a truthy non-boolean is not acceptance', () => {
  const registry = registryWith(() => ({ parsed: true }))
  assert.throws(() => validateStructuralFact(registry, rawFact()), invalidParams)
})

test('the diagnostic names the operation, the path and the dimension', () => {
  const registry = registryWith(() => false)
  assert.throws(
    () =>
      validateStructuralFact(registry, rawFact({ dimension: 'storybook', path: 'apps/web/x.mjs' })),
    (error) =>
      invalidParams(error) &&
      error.paths.includes('apps/web/x.mjs') &&
      error.dimensions.includes('storybook') &&
      error.message.includes('"op-a"')
  )
})

test('validateStructuralFacts maps over a raw fact array', () => {
  const registry = registryWith(() => true)
  const facts = validateStructuralFacts(registry, [rawFact({ path: 'a' }), rawFact({ path: 'b' })])
  assert.equal(facts.length, 2)
})
