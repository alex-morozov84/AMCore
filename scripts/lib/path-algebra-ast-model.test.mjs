import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { parseStructuralModel, serializeStructuralModel } from './path-algebra-ast-model.mjs'
import { findUniqueNode, isStringLiteralText } from './path-algebra-ast-query.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { conflict } from './path-algebra-test-helpers.mjs'

const PATH = 'apps/web/example.mjs'
const ctx = (operationKey = 'op-a') => ({ path: PATH, operationKey, describe: 'node' })

function modelOf(text) {
  return parseStructuralModel(PATH, text)
}

test('parseStructuralModel parses once and exposes the tree, the text and the path', () => {
  const model = modelOf("import a from 'a';\nexport default [a];\n")
  assert.equal(model.path, PATH)
  assert.equal(model.sourceFile.statements.length, 2)
  assert.equal(model.edits.length, 0)
})

test('input that does not parse fails closed with invalid-input-parse and a line number', () => {
  assert.throws(
    () => modelOf("import a from 'a';\nexport default (((;\n"),
    (error) => conflict(CONFLICT_CODES.INVALID_INPUT_PARSE)(error) && /line 2/.test(error.message)
  )
})

test('replaceNode swaps exactly the node text, keeping surrounding trivia', () => {
  const model = modelOf("const a = 'old'; // note\n")
  model.replaceNode(
    findUniqueNode(model, (node) => isStringLiteralText(node, 'old'), ctx()),
    "'new'",
    ctx()
  )
  assert.equal(serializeStructuralModel(model), "const a = 'new'; // note\n")
})

test('isRemoved reports a node inside an earlier removal, so a dependent operation can see it', () => {
  const model = modelOf('export default [{ a: 1 }, { b: 2 }];\n')
  const first = findUniqueNode(
    model,
    (node) =>
      ts.isObjectLiteralExpression(node) &&
      node.properties.length === 1 &&
      node.properties[0].name.text === 'a',
    ctx()
  )
  const inner = first.properties[0]
  assert.equal(model.isRemoved(inner), false)
  model.removeNode(first, ctx())
  assert.equal(model.isRemoved(inner), true)
  assert.equal(model.isRemoved(model.sourceFile.statements[0]), false)
})

test('overlapping edits from two operations fail closed, naming both', () => {
  const model = modelOf("export default [{ a: ['x'] }];\n")
  const outer = findUniqueNode(model, ts.isObjectLiteralExpression, ctx('op-outer'))
  const inner = findUniqueNode(model, (node) => isStringLiteralText(node, 'x'), ctx('op-inner'))
  model.removeNode(outer, ctx('op-outer'))
  model.replaceNode(inner, "'y'", ctx('op-inner'))
  assert.throws(
    () => serializeStructuralModel(model),
    (error) =>
      conflict(CONFLICT_CODES.OVERLAPPING_STRUCTURAL_EDITS)(error) &&
      error.message.includes('"op-outer"') &&
      error.message.includes('"op-inner"')
  )
})

test('identical edits from agreeing operations deduplicate', () => {
  const model = modelOf("export default ['x'];\n")
  const node = findUniqueNode(model, (candidate) => isStringLiteralText(candidate, 'x'), ctx())
  model.removeNode(node, ctx('op-a'))
  model.removeNode(node, ctx('op-b'))
  assert.equal(serializeStructuralModel(model), 'export default [];\n')
})

test('output that no longer parses fails closed with invalid-output-parse — no adapter opt-in needed', () => {
  const model = modelOf('export default [1];\n')
  model.replaceNode(model.sourceFile.statements[0].expression, '(((', ctx())
  assert.throws(
    () => serializeStructuralModel(model),
    conflict(CONFLICT_CODES.INVALID_OUTPUT_PARSE)
  )
})

test('a TypeScript-only construct in a .mjs output is a parse failure, not silently accepted', () => {
  const model = modelOf('const a = 1;\n')
  model.replaceNode(model.sourceFile.statements[0], 'const a: number = 1;', ctx())
  assert.throws(
    () => serializeStructuralModel(model),
    conflict(CONFLICT_CODES.INVALID_OUTPUT_PARSE)
  )
})

test('a .ts path parses TypeScript syntax', () => {
  const model = parseStructuralModel('apps/web/example.ts', 'export const a: number = 1;\n')
  assert.equal(serializeStructuralModel(model), 'export const a: number = 1;\n')
})

test('serializing with no edits returns the input unchanged', () => {
  const source = "import a from 'a';\n\n// kept\nexport default [a];\n"
  assert.equal(serializeStructuralModel(modelOf(source)), source)
})
