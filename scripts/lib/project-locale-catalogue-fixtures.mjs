import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'

const COPY = {
  sessions: { Actions: 'Действия', 'This device': 'Это устройство' },
  oauth: { 'Continue with Google': 'Продолжить с Google' },
  section: {},
}

function jsonImports(model, locale) {
  return findAllNodes(
    model,
    (node) =>
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.endsWith(`/messages/${locale}.json`)
  )
}

function retainImport(model, locale, requireRu, ctx) {
  const [en, ...extraEn] = jsonImports(model, 'en')
  const [ru, ...extraRu] = jsonImports(model, 'ru')
  if (!en || extraEn.length || (requireRu && !ru) || extraRu.length) {
    throw new Error('catalogue imports are missing or ambiguous')
  }
  if (locale === 'ru') {
    const specifier = en.moduleSpecifier.text.replace('/en.json', '/ru.json')
    model.replaceNode(en, `import ru from '${specifier}'`, ctx)
  }
  if (ru) model.removeNode(ru, ctx)
}

function replaceStrings(model, replacements, ctx) {
  const nodes = findAllNodes(
    model,
    (node) => ts.isStringLiteral(node) && replacements[node.text] !== undefined
  )
  for (const node of nodes) model.replaceNode(node, `'${replacements[node.text]}'`, ctx)
}

function catalogueObject(model, locale, ctx) {
  const declaration = findUniqueNode(
    model,
    (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'catalogues',
    { ...ctx, describe: 'catalogues declaration' }
  )
  const object = findUniqueNode(
    model,
    (node) => ts.isObjectLiteralExpression(node),
    {
      ...ctx,
      describe: 'catalogues object',
    },
    declaration.initializer
  )
  model.replaceNode(object, `{ ${locale} }`, ctx)
}

export function singleCatalogueFixture(model, { locale, variant }, ctx) {
  retainImport(model, locale, variant === 'errors', ctx)
  if (variant === 'errors') {
    catalogueObject(model, locale, ctx)
    return
  }
  if (locale === 'ru') replaceStrings(model, COPY[variant], ctx)
  const attributes = findAllNodes(
    model,
    (node) => ts.isJsxAttribute(node) && ['locale', 'messages'].includes(node.name.getText())
  )
  for (const attribute of attributes) {
    if (attribute.name.getText() === 'locale')
      model.replaceNode(attribute.initializer, `"${locale}"`, ctx)
    else model.replaceNode(attribute.initializer, `{${locale}}`, ctx)
  }
}

export const fixtureParams = (params) =>
  params !== null &&
  typeof params === 'object' &&
  Object.keys(params).length === 2 &&
  ['en', 'ru'].includes(params.locale) &&
  ['errors', 'sessions', 'oauth', 'section'].includes(params.variant)
