// Semantic node discovery for structural adapters (BACKLOG item 14, PR2/M2,
// FINAL PLAN §2.2). An adapter describes the node it needs by AST shape —
// "the import of module X", "the config block whose `name` is Y" — never by
// a copied block of source text, so unrelated comments, formatting and
// sibling declarations cannot break it. Zero or several matches fail closed.
import ts from 'typescript'
import { PathAlgebraConflictError, CONFLICT_CODES } from './path-algebra-errors.mjs'

// `forEachChild` stops as soon as its callback returns a truthy value, so the
// recursive visit must return nothing — returning the array would end the walk
// after the first child.
function collectMatches(root, predicate, matches) {
  if (predicate(root)) matches.push(root)
  ts.forEachChild(root, (child) => {
    collectMatches(child, predicate, matches)
  })
  return matches
}

/**
 * Returns the single node under `root` (default: the whole file) matching
 * `predicate`. `describe` names the semantic shape in the diagnostic, e.g.
 * "import of 'eslint-plugin-storybook'". Throws `MISSING_SEMANTIC_NODE`
 * on zero matches and `AMBIGUOUS_SEMANTIC_NODE` on more than one.
 */
export function findUniqueNode(
  model,
  predicate,
  { operationKey, describe },
  root = model.sourceFile
) {
  const matches = collectMatches(root, predicate, [])
  if (matches.length === 1) return matches[0]
  const code =
    matches.length === 0
      ? CONFLICT_CODES.MISSING_SEMANTIC_NODE
      : CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE
  throw new PathAlgebraConflictError(code, {
    paths: [model.path],
    dimensions: [],
    detail: `operationKey "${operationKey}" expected exactly one ${describe} in "${model.path}", found ${matches.length}`,
  })
}

/** Every node under `root` matching `predicate`, in source order (for shapes that may legitimately repeat). */
export function findAllNodes(model, predicate, root = model.sourceFile) {
  return collectMatches(root, predicate, [])
}

/** `import ... from '<moduleSpecifier>'` — matched on the specifier, not the binding name or spacing. */
export function isImportOf(node, moduleSpecifier) {
  return (
    ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text === moduleSpecifier
  )
}

/** A string literal (either quote style) with exactly this text. */
export function isStringLiteralText(node, text) {
  return ts.isStringLiteral(node) && node.text === text
}

/** `const <name> = ...` / `let` / `var` — the whole statement, so its removal takes the declaration with it. */
export function isVariableStatementNamed(node, name) {
  return (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name
    )
  )
}

function propertyNameText(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
}

/**
 * The `<name>: <initializer>` assignment of an object literal (`name` or
 * `'name'` key), or `undefined` when absent. Shorthand (`{ name }`),
 * computed and spread members are deliberately not matched: they carry no
 * literal value to assert on.
 */
export function objectLiteralProperty(node, name) {
  if (!ts.isObjectLiteralExpression(node)) return undefined
  return node.properties.find(
    (property) => ts.isPropertyAssignment(property) && propertyNameText(property.name) === name
  )
}

/** An object literal whose `<name>` property is the string literal `value` — how config blocks are identified. */
export function hasStringProperty(node, name, value) {
  const property = objectLiteralProperty(node, name)
  return property !== undefined && isStringLiteralText(property.initializer, value)
}

/** Whether an expression refers to `identifier` at its root: `x`, `x.y`, `x[y]`, `x(...)` and their nestings. */
export function isRootedInIdentifier(node, identifier) {
  let current = node
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current) ||
    ts.isCallExpression(current)
  ) {
    current = current.expression
  }
  return ts.isIdentifier(current) && current.text === identifier
}
