import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { testCall } from './project-locale-ast-helpers.mjs'

function catalogueImports(model, ctx) {
  return Object.fromEntries(
    ['en', 'ru'].map((code) => [
      code,
      findUniqueNode(
        model,
        (node) =>
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text.endsWith(`/messages/${code}.json`),
        { ...ctx, describe: `${code} catalogue import` }
      ),
    ])
  )
}

function catalogueObject(model, ctx) {
  const declaration = findUniqueNode(
    model,
    (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'catalogues',
    { ...ctx, describe: 'catalogues declaration' }
  )
  return findUniqueNode(
    model,
    (node) => ts.isObjectLiteralExpression(node),
    {
      ...ctx,
      describe: 'catalogues object',
    },
    declaration.initializer
  )
}

export function retainWebCatalogue(model, locale, ctx) {
  const imports = catalogueImports(model, ctx)
  if (locale === 'ru') {
    const specifier = imports.en.moduleSpecifier.text.replace('/en.json', '/ru.json')
    model.replaceNode(imports.en, `import ru from '${specifier}'`, ctx)
  }
  model.removeNode(imports.ru, ctx)
  model.replaceNode(catalogueObject(model, ctx), `{ ${locale} }`, ctx)
}

export function replaceLiteral(model, before, after, ctx, root = model.sourceFile) {
  const nodes = findAllNodes(
    model,
    (node) => ts.isStringLiteral(node) && node.text === before,
    root
  )
  for (const node of nodes.filter((item) => !model.isRemoved(item))) {
    model.replaceNode(node, `'${after.replaceAll("'", "\\'")}'`, ctx)
  }
}

export function removeTests(model, titles, ctx) {
  for (const title of titles) model.removeNode(testCall(model, title, ctx), ctx)
}

export function localeDefaults(model, locale, ctx) {
  const parameters = findAllNodes(
    model,
    (node) => ts.isParameter(node) && node.name.getText() === 'locale' && node.initializer
  )
  for (const parameter of parameters) model.replaceNode(parameter.initializer, `'${locale}'`, ctx)
}
