// Orchestrator planning behaviour on a small synthetic source: what fails
// before any adapter runs, how dedup and dependency order reach the shared
// model, and per-path independence.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { planStructuralComposition } from './path-algebra-structural-compose.mjs'
import { findUniqueNode, isImportOf, isStringLiteralText } from './path-algebra-ast-query.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import {
  composeSynthetic,
  conflict,
  removeImportDefinition,
  stubDefinition,
  syntheticFact as fact,
} from './path-algebra-test-helpers.mjs'

test('overlapping edits from two operations fail at serialization, not silently', () => {
  const registry = createOperationRegistry()
  registry.define(
    'drop-list',
    stubDefinition({
      deriveSemanticWrites: () => [{ location: 'list', value: 'absent' }],
      adapter: (model, params, ctx) =>
        model.replaceNode(model.sourceFile.statements[2].expression, '[]', ctx),
    })
  )
  registry.define(
    'drop-x',
    stubDefinition({
      deriveSemanticWrites: () => [{ location: 'list:x', value: 'absent' }],
      adapter: (model, params, ctx) =>
        model.removeNode(
          findUniqueNode(model, (n) => isStringLiteralText(n, 'x'), { ...ctx, describe: 'x' }),
          ctx
        ),
    })
  )
  assert.throws(
    () => composeSynthetic(registry, [fact('drop-list'), fact('drop-x')]),
    conflict(CONFLICT_CODES.OVERLAPPING_STRUCTURAL_EDITS)
  )
})

test('dependsOn orders adapters so a dependent operation observes its dependency on the shared model', () => {
  const registry = createOperationRegistry()
  const observed = []
  registry.define('remove-a', removeImportDefinition('a'))
  registry.define(
    'after-a',
    stubDefinition({
      dependsOn: ['remove-a'],
      deriveSemanticWrites: () => [{ location: 'observer', value: true }],
      adapter: (model, params, ctx) => {
        const importA = findUniqueNode(model, (n) => isImportOf(n, 'a'), {
          ...ctx,
          describe: 'import',
        })
        observed.push(model.isRemoved(importA))
      },
    })
  )
  composeSynthetic(registry, [fact('after-a'), fact('remove-a')])
  assert.deepEqual(observed, [true])
})

test('the same operation from two dimensions runs once, so its edit is not recorded twice', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', removeImportDefinition('a'))
  assert.equal(
    composeSynthetic(registry, [fact('op-a', 'd1'), fact('op-a', 'd2')]),
    "import b from 'b';\nexport default ['x', 'y'];\n"
  )
})

test('planning fails closed on a cross-key semantic conflict before any adapter runs', () => {
  const registry = createOperationRegistry()
  let ran = false
  const claiming = (value) =>
    stubDefinition({
      deriveSemanticWrites: () => [{ location: 'l', value }],
      adapter: () => void (ran = true),
    })
  registry.define('op-a', claiming(1))
  registry.define('op-b', claiming(2))
  assert.throws(
    () => planStructuralComposition(registry, [fact('op-a'), fact('op-b')]),
    conflict(CONFLICT_CODES.SEMANTIC_WRITE_CONFLICT)
  )
  assert.equal(ran, false)
})

test('planning fails closed on an unknown dependency before any adapter runs', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', stubDefinition({ dependsOn: ['op-never-defined'] }))
  assert.throws(
    () => planStructuralComposition(registry, [fact('op-a')]),
    conflict(CONFLICT_CODES.UNKNOWN_OPERATION_DEPENDENCY)
  )
})

test('facts on different paths plan independently, path-sorted', () => {
  const registry = createOperationRegistry()
  registry.define('op-a', removeImportDefinition('a'))
  const plans = planStructuralComposition(registry, [
    { ...fact('op-a'), path: 'z.mjs' },
    { ...fact('op-a'), path: 'a.mjs' },
  ])
  assert.deepEqual(
    plans.map((plan) => plan.path),
    ['a.mjs', 'z.mjs']
  )
})
