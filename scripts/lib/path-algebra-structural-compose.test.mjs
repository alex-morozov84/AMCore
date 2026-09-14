// Orchestrator representation contract on a small synthetic source: one
// parse, adapters edit one shared model, one validated serialization, and
// a defective adapter is diagnosed rather than trusted. Planning-side
// behaviour is in path-algebra-structural-compose-plan.test.mjs; real-file
// compositions in path-algebra-eslint-compose.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOperationRegistry } from './path-algebra-operation-registry.mjs'
import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import {
  composeSynthetic,
  conflict,
  removeImportDefinition,
  stubDefinition,
  syntheticFact as fact,
} from './path-algebra-test-helpers.mjs'

const defaultExportExpression = (model) => model.sourceFile.statements[2].expression

test('adapters of one file share one model: two operations, one parse, one serialization', () => {
  const registry = createOperationRegistry()
  const seen = new Set()
  const observing = (specifier) => {
    const definition = removeImportDefinition(specifier)
    return {
      ...definition,
      adapter: (model, params, ctx) => {
        seen.add(model)
        definition.adapter(model, params, ctx)
      },
    }
  }
  registry.define('op-a', observing('a'))
  registry.define('op-b', observing('b'))
  assert.equal(
    composeSynthetic(registry, [fact('op-a'), fact('op-b')]),
    "export default ['x', 'y'];\n"
  )
  assert.equal(seen.size, 1)
})

test('an adapter that breaks syntax fails with invalid-output-parse without calling any validation itself', () => {
  const registry = createOperationRegistry()
  registry.define(
    'corrupt',
    stubDefinition({
      adapter: (model, params, ctx) =>
        model.replaceNode(defaultExportExpression(model), '(((', ctx),
    })
  )
  assert.throws(
    () => composeSynthetic(registry, [fact('corrupt')]),
    conflict(CONFLICT_CODES.INVALID_OUTPUT_PARSE)
  )
})

test('an adapter returning a value (its own representation) is rejected as an invalid definition', () => {
  const registry = createOperationRegistry()
  registry.define('returns-text', stubDefinition({ adapter: () => 'export default [];\n' }))
  assert.throws(
    () => composeSynthetic(registry, [fact('returns-text')]),
    conflict(CONFLICT_CODES.INVALID_OPERATION_DEFINITION)
  )
})

test('an adapter that throws a plain error is reported as a diagnosable definition failure with its message', () => {
  const registry = createOperationRegistry()
  registry.define(
    'defective',
    stubDefinition({
      adapter: (model) => model.removeNode(undefined, { operationKey: 'defective' }),
    })
  )
  assert.throws(
    () => composeSynthetic(registry, [fact('defective')]),
    (error) =>
      conflict(CONFLICT_CODES.INVALID_OPERATION_DEFINITION)(error) && /threw "/.test(error.message)
  )
})

test('a structured diagnostic thrown inside an adapter passes through unchanged', () => {
  const registry = createOperationRegistry()
  registry.define('op-c', removeImportDefinition('c'))
  assert.throws(
    () => composeSynthetic(registry, [fact('op-c')]),
    conflict(CONFLICT_CODES.MISSING_SEMANTIC_NODE)
  )
})

test('input that does not parse fails before any adapter runs', () => {
  const registry = createOperationRegistry()
  let ran = false
  registry.define('op-a', stubDefinition({ adapter: () => void (ran = true) }))
  assert.throws(
    () => composeSynthetic(registry, [fact('op-a')], 'export default (((;\n'),
    conflict(CONFLICT_CODES.INVALID_INPUT_PARSE)
  )
  assert.equal(ran, false)
})

test('an ambiguous semantic node propagates out of composition', () => {
  const registry = createOperationRegistry()
  registry.define(
    'any-import',
    stubDefinition({
      adapter: (model, params, ctx) => {
        const importKind = model.sourceFile.statements[0].kind
        model.removeNode(
          findUniqueNode(model, (n) => n.kind === importKind, { ...ctx, describe: 'import' }),
          ctx
        )
      },
    })
  )
  assert.throws(
    () => composeSynthetic(registry, [fact('any-import')]),
    conflict(CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE)
  )
})
