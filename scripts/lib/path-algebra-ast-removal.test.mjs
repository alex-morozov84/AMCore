// Removal-range semantics of the structural model: what text a node's
// removal takes so the result stays well-formed and minimal — lines for
// statements, separators for list elements, attached (not detached)
// leading comments. The model's parse/serialize contract is in
// path-algebra-ast-model.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { parseStructuralModel, serializeStructuralModel } from './path-algebra-ast-model.mjs'
import {
  findUniqueNode,
  isImportOf,
  isStringLiteralText,
  isVariableStatementNamed,
} from './path-algebra-ast-query.mjs'

const PATH = 'apps/web/example.mjs'
const ctx = (operationKey = 'op-a') => ({ path: PATH, operationKey, describe: 'node' })

function modelOf(text) {
  return parseStructuralModel(PATH, text)
}

test('removing a statement takes its line with it and nothing else', () => {
  const model = modelOf(
    "import a from 'a';\nimport b from 'b';\nimport c from 'c';\nexport default [a, b, c];\n"
  )
  model.removeNode(
    findUniqueNode(model, (node) => isImportOf(node, 'b'), ctx()),
    ctx()
  )
  const output = serializeStructuralModel(model)
  assert.equal(output, "import a from 'a';\nimport c from 'c';\nexport default [a, b, c];\n")
})

test('removing the first statement of a file takes its line break, leaving no leading blank line', () => {
  const model = modelOf("import a from 'a';\nimport b from 'b';\n")
  model.removeNode(
    findUniqueNode(model, (node) => isImportOf(node, 'a'), ctx()),
    ctx()
  )
  assert.equal(serializeStructuralModel(model), "import b from 'b';\n")
})

test('removing a list element takes its separating comma so the list stays well-formed', () => {
  const model = modelOf("export default ['x', 'y', 'z'];\n")
  model.removeNode(
    findUniqueNode(model, (node) => isStringLiteralText(node, 'y'), ctx()),
    ctx()
  )
  assert.equal(serializeStructuralModel(model), "export default ['x', 'z'];\n")
})

test('removing a first element on one line takes the space after its comma, not a newline', () => {
  const model = modelOf("export default ['x', 'y'];\n")
  model.removeNode(
    findUniqueNode(model, (node) => isStringLiteralText(node, 'x'), ctx()),
    ctx()
  )
  assert.equal(serializeStructuralModel(model), "export default ['y'];\n")
})

test('removing a last list element with no trailing comma takes the comma before it instead', () => {
  const model = modelOf('export default { a: 1, b: 2 };\n')
  model.removeNode(
    findUniqueNode(model, (node) => ts.isPropertyAssignment(node) && node.name.text === 'b', ctx()),
    ctx()
  )
  assert.equal(serializeStructuralModel(model), 'export default { a: 1 };\n')
})

test('removing a multi-line list element takes its own lines and trailing comma', () => {
  const model = modelOf("export default [\n  'x',\n  'y',\n  'z',\n];\n")
  model.removeNode(
    findUniqueNode(model, (node) => isStringLiteralText(node, 'y'), ctx()),
    ctx()
  )
  assert.equal(serializeStructuralModel(model), "export default [\n  'x',\n  'z',\n];\n")
})

test('an attached leading comment is removed with its node; a detached one (blank line between) stays', () => {
  const source =
    'const a = 1;\n\n// section banner\n\n// describes b\nconst b = 2;\n\nconst c = 3;\n'
  const model = modelOf(source)
  model.removeNode(
    findUniqueNode(model, (node) => isVariableStatementNamed(node, 'b'), ctx()),
    ctx()
  )
  assert.equal(
    serializeStructuralModel(model),
    'const a = 1;\n\n// section banner\n\nconst c = 3;\n'
  )
})

test('edits from several operations apply in one pass regardless of recording order', () => {
  const model = modelOf("export default ['x', 'y', 'z'];\n")
  model.removeNode(
    findUniqueNode(model, (node) => isStringLiteralText(node, 'z'), ctx('op-z')),
    ctx('op-z')
  )
  model.removeNode(
    findUniqueNode(model, (node) => isStringLiteralText(node, 'x'), ctx('op-x')),
    ctx('op-x')
  )
  assert.equal(serializeStructuralModel(model), "export default ['y'];\n")
})
