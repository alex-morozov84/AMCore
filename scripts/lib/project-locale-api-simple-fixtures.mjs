import ts from 'typescript'

import { findAllNodes } from './path-algebra-ast-query.mjs'
import { testCall } from './project-locale-ast-helpers.mjs'

function isModuleSpecifier(node) {
  return ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)
}

export function normalizeLocaleLiterals(model, locale, ctx) {
  const literals = findAllNodes(
    model,
    (node) =>
      ts.isStringLiteral(node) && ['en', 'ru'].includes(node.text) && !isModuleSpecifier(node)
  )
  for (const literal of literals) model.replaceNode(literal, `'${locale}'`, ctx)
  const accesses = findAllNodes(
    model,
    (node) =>
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      ['en', 'ru'].includes(node.name.text)
  )
  for (const access of accesses) model.replaceNode(access.name, locale, ctx)
}

export function normalizeRussianFixtureLiterals(model, locale, ctx) {
  const literals = findAllNodes(
    model,
    (node) => ts.isStringLiteral(node) && node.text === 'ru' && !isModuleSpecifier(node)
  )
  for (const literal of literals) model.replaceNode(literal, `'${locale}'`, ctx)
}

function removeLocaleProperties(model, root, ctx) {
  const properties = findAllNodes(
    model,
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'locale' &&
      node.getStart() >= root.getStart() &&
      node.end <= root.end
  )
  if (properties.length !== 4)
    throw new Error(`expected four supplied locale properties, found ${properties.length}`)
  for (const property of properties) model.removeNode(property, ctx)
}

export function rewriteAuthServiceSpecialCase(model, ctx) {
  const test = testCall(
    model,
    'writes only the supplied fields and invalidates the user cache',
    ctx
  )
  removeLocaleProperties(model, test, ctx)
}

export function dropLocalePrefixLiterals(model, ctx) {
  const strings = findAllNodes(
    model,
    (node) => ts.isStringLiteral(node) && /\/(?:en|ru)(?:\/|$)/.test(node.text)
  )
  for (const literal of strings) {
    model.replaceNode(literal, `'${literal.text.replace(/\/(?:en|ru)(?=\/|$)/g, '')}'`, ctx)
  }
}
