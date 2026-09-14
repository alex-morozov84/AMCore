import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { parseStructuralModel } from './path-algebra-ast-model.mjs'
import {
  findAllNodes,
  findUniqueNode,
  hasStringProperty,
  isImportOf,
  isRootedInIdentifier,
  isStringLiteralText,
  isVariableStatementNamed,
  objectLiteralProperty,
} from './path-algebra-ast-query.mjs'
import { CONFLICT_CODES } from './path-algebra-errors.mjs'
import { conflict } from './path-algebra-test-helpers.mjs'

const PATH = 'apps/web/example.mjs'
const ctx = { path: PATH, operationKey: 'op-a', describe: 'thing' }
const SOURCE = [
  "import plugin from 'some-plugin';",
  'import { x } from "double-quoted";',
  'const NAMED = 1;',
  "export default [{ name: 'block-a', rules: { 'rule-x': 1 } }, { name: 'block-b' }, ...plugin.configs['flat'], plugin.other()];",
  '',
].join('\n')
const model = parseStructuralModel(PATH, SOURCE)

test('findUniqueNode returns the single match', () => {
  const node = findUniqueNode(model, (n) => isImportOf(n, 'some-plugin'), ctx)
  assert.ok(ts.isImportDeclaration(node))
})

test('findUniqueNode fails closed on zero matches with missing-semantic-node naming the shape', () => {
  assert.throws(
    () => findUniqueNode(model, (n) => isImportOf(n, 'absent'), ctx),
    (error) =>
      conflict(CONFLICT_CODES.MISSING_SEMANTIC_NODE)(error) &&
      error.message.includes('thing') &&
      error.message.includes('"op-a"') &&
      error.message.includes('found 0')
  )
})

test('findUniqueNode fails closed on several matches with ambiguous-semantic-node', () => {
  assert.throws(
    () => findUniqueNode(model, ts.isImportDeclaration, ctx),
    (error) =>
      conflict(CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE)(error) && error.message.includes('found 2')
  )
})

test('findUniqueNode scoped to a subtree ignores matches outside it', () => {
  const blockB = findUniqueNode(model, (n) => hasStringProperty(n, 'name', 'block-b'), ctx)
  assert.throws(
    () => findUniqueNode(model, ts.isStringLiteral, ctx),
    conflict(CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE)
  )
  assert.equal(findUniqueNode(model, ts.isStringLiteral, ctx, blockB).text, 'block-b')
})

test('findAllNodes visits every descendant, not only the first child at each level', () => {
  // 'some-plugin', "double-quoted", 'block-a', 'rule-x' (a string-literal key), 'block-b', 'flat'
  assert.equal(findAllNodes(model, ts.isStringLiteral).length, 6)
  assert.equal(findAllNodes(model, ts.isObjectLiteralExpression).length, 3)
})

test('isImportOf matches the module specifier under either quote style, not the binding', () => {
  assert.equal(findAllNodes(model, (n) => isImportOf(n, 'double-quoted')).length, 1)
  assert.equal(findAllNodes(model, (n) => isImportOf(n, 'plugin')).length, 0)
})

test('isStringLiteralText matches value, not quoting', () => {
  assert.equal(findAllNodes(model, (n) => isStringLiteralText(n, 'flat')).length, 1)
})

test('isVariableStatementNamed matches the whole statement by declared name', () => {
  const statement = findUniqueNode(model, (n) => isVariableStatementNamed(n, 'NAMED'), ctx)
  assert.ok(ts.isVariableStatement(statement))
  assert.equal(findAllNodes(model, (n) => isVariableStatementNamed(n, 'OTHER')).length, 0)
})

test('objectLiteralProperty reads identifier and string-literal keys, and undefined when absent', () => {
  const blockA = findUniqueNode(model, (n) => hasStringProperty(n, 'name', 'block-a'), ctx)
  const rules = objectLiteralProperty(blockA, 'rules')
  assert.ok(rules)
  assert.ok(objectLiteralProperty(rules.initializer, 'rule-x'))
  assert.equal(objectLiteralProperty(blockA, 'absent'), undefined)
  assert.equal(objectLiteralProperty(model.sourceFile, 'name'), undefined)
})

test('hasStringProperty identifies a config block by its name value', () => {
  assert.equal(findAllNodes(model, (n) => hasStringProperty(n, 'name', 'block-b')).length, 1)
  assert.equal(findAllNodes(model, (n) => hasStringProperty(n, 'name', 'block-c')).length, 0)
})

test('isRootedInIdentifier sees through property, element and call access chains', () => {
  const spreads = findAllNodes(model, ts.isSpreadElement)
  assert.equal(spreads.length, 1)
  assert.equal(isRootedInIdentifier(spreads[0].expression, 'plugin'), true)
  assert.equal(isRootedInIdentifier(spreads[0].expression, 'other'), false)
  const call = findUniqueNode(model, ts.isCallExpression, ctx)
  assert.equal(isRootedInIdentifier(call, 'plugin'), true)
})
