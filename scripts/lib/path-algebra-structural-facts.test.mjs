import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { validateStructuralFact, validateStructuralFacts } from './path-algebra-structural-facts.mjs'

function registryWith(schema) {
  const registry = createOperationRegistry()
  registry.define('op-a', {
    paramsSchema: schema,
    deriveSemanticWrites: () => [{ location: 'x', value: 1 }],
  })
  return registry
}

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
    () =>
      validateStructuralFact(registry, { dimension: 'd', path: 'x', operationKey: 'missing', params: {} }),
    /unknown-operation-key/
  )
})

test('params rejected by paramsSchema throw invalid-operation-params', () => {
  const registry = registryWith(() => false)
  assert.throws(
    () => validateStructuralFact(registry, { dimension: 'd', path: 'x', operationKey: 'op-a', params: {} }),
    /invalid-operation-params/
  )
})

test('validateStructuralFacts maps over a raw fact array', () => {
  const registry = registryWith(() => true)
  const facts = validateStructuralFacts(registry, [
    { dimension: 'd', path: 'a', operationKey: 'op-a', params: {} },
    { dimension: 'd', path: 'b', operationKey: 'op-a', params: {} },
  ])
  assert.equal(facts.length, 2)
})
