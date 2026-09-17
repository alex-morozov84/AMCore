import ts from 'typescript'

import { escapeTsSingleQuoteInner } from './actions.mjs'
import { findUniqueNode, objectLiteralProperty } from './path-algebra-ast-query.mjs'

const MANIFEST_KEY = 'brand.set-manifest-fields'
const THEME_KEY = 'brand.set-theme-default'
const themes = new Set(['system', 'light', 'dark'])

function optionalStrings(params, fields) {
  if (!params || typeof params !== 'object') return false
  return (
    Object.keys(params).every((key) => fields.includes(key)) &&
    Object.values(params).every((value) => typeof value === 'string')
  )
}

function manifestObject(model, ctx) {
  const fn = findUniqueNode(
    model,
    (node) =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'manifest' &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
    { ...ctx, describe: 'default manifest function' }
  )
  const returned = findUniqueNode(
    model,
    ts.isReturnStatement,
    { ...ctx, describe: 'return statement' },
    fn
  )
  if (!returned.expression || !ts.isObjectLiteralExpression(returned.expression)) {
    return findUniqueNode(
      model,
      () => false,
      { ...ctx, describe: 'returned manifest object' },
      returned
    )
  }
  return returned.expression
}

function setStringProperty(model, object, name, value, ctx) {
  const property = findUniqueNode(
    model,
    (node) => objectLiteralProperty(object, name) === node,
    { ...ctx, describe: `manifest property "${name}"` },
    object
  )
  if (!ts.isStringLiteral(property.initializer)) {
    return findUniqueNode(model, () => false, { ...ctx, describe: `string value for "${name}"` })
  }
  model.replaceNode(property.initializer, `'${escapeTsSingleQuoteInner(value)}'`, ctx)
}

function setManifest(model, params, ctx) {
  const object = manifestObject(model, ctx)
  for (const [name, value] of Object.entries(params))
    setStringProperty(model, object, name, value, ctx)
}

function setTheme(model, params, ctx) {
  const declaration = findUniqueNode(
    model,
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'DEFAULT_THEME_SETTING',
    { ...ctx, describe: 'DEFAULT_THEME_SETTING declaration' }
  )
  if (!declaration.initializer || !ts.isStringLiteral(declaration.initializer)) {
    return findUniqueNode(model, () => false, {
      ...ctx,
      describe: 'DEFAULT_THEME_SETTING string initializer',
    })
  }
  model.replaceNode(declaration.initializer, `'${params.theme}'`, ctx)
}

export function registerBrandStructuralOperations(registry) {
  registry.define(MANIFEST_KEY, {
    paramsSchema: (params) => optionalStrings(params, ['name', 'short_name', 'description']),
    deriveSemanticWrites: (params) =>
      Object.entries(params).map(([name, value]) => ({ location: `ts:manifest:${name}`, value })),
    adapter: setManifest,
  })
  registry.define(THEME_KEY, {
    paramsSchema: (params) =>
      params && Object.keys(params).length === 1 && themes.has(params.theme),
    deriveSemanticWrites: ({ theme }) => [
      { location: 'ts:exported-const:DEFAULT_THEME_SETTING:initializer', value: theme },
    ],
    adapter: setTheme,
  })
}
