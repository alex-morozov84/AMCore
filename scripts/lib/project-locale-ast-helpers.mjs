import ts from 'typescript'

import { findAllNodes, findUniqueNode, isImportOf } from './path-algebra-ast-query.mjs'

export const localeParams = (params) =>
  params !== null &&
  typeof params === 'object' &&
  Object.keys(params).length === 1 &&
  ['en', 'ru'].includes(params.locale)

export const absent = (location) => ({ location, value: 'absent' })
export const claim = (location, value) => ({ location, value })

export function uniqueImport(model, moduleName, ctx) {
  return findUniqueNode(model, (node) => isImportOf(node, moduleName), {
    ...ctx,
    describe: `import of "${moduleName}"`,
  })
}

export function uniqueFunction(model, name, ctx) {
  return findUniqueNode(
    model,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
    { ...ctx, describe: `function "${name}"` }
  )
}

export function defaultFunction(model, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.modifiers?.some((item) => item.kind === ts.SyntaxKind.DefaultKeyword),
    { ...ctx, describe: 'default-exported function' }
  )
}

export function uniqueVariable(model, names, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      names.includes(node.name.text),
    { ...ctx, describe: `variable ${names.join(' or ')}` }
  )
}

export function objectProperty(model, object, name, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.parent === object &&
      ((ts.isIdentifier(node.name) && node.name.text === name) ||
        (ts.isStringLiteral(node.name) && node.name.text === name)),
    { ...ctx, describe: `object property "${name}"` },
    object
  )
}

export function calls(model, predicate) {
  return findAllNodes(model, (node) => ts.isCallExpression(node) && predicate(node))
}

export function callName(node) {
  if (ts.isIdentifier(node.expression)) return node.expression.text
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text
  return undefined
}

export function testCall(model, title, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      ['it', 'test'].includes(callName(node)) &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === title,
    { ...ctx, describe: `test named "${title}"` }
  )
}

export function attachedJSDoc(model, owner, text, ctx) {
  const matches = (owner.jsDoc ?? []).filter((doc) => doc.getText().includes(text))
  if (matches.length !== 1) {
    throw new Error(
      `${ctx.operationKey}: expected exactly one attached JSDoc containing "${text}", found ${matches.length}`
    )
  }
  return matches[0]
}
