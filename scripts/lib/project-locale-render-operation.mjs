import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { attachedJSDoc, callName, claim, localeParams } from './project-locale-ast-helpers.mjs'
import { renderWord, replaceRenderData } from './project-locale-render-data-operation.mjs'

function named(model, predicate, describe, ctx, root) {
  return findUniqueNode(model, predicate, { ...ctx, describe }, root)
}

function renderSuiteNode(model, ctx) {
  return named(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'describe' &&
      node.arguments[0]?.text === 'email templates — render robustness (EQS-08)',
    'render robustness suite',
    ctx
  )
}

function rewriteRenderDoc(model, ctx) {
  const first = model.sourceFile.statements[0]
  const doc = attachedJSDoc(model, first, 'render-robustness', ctx)
  const next = doc
    .getText()
    .replace('in both locales', 'in the one supported locale')
    .replace('locale fallback to Russian', 'locale fallback to the one supported locale')
  model.replaceNode(doc, next, ctx)
}

function rewriteParameterizedTest(model, statement, locale, ctx) {
  const outer = statement.expression
  const callback = outer.arguments[1]
  if (!ts.isArrowFunction(callback) || !ts.isBlock(callback.body)) {
    throw new Error(`${ctx.operationKey}: expected parameterized render callback`)
  }
  const title = outer.arguments[0]
  if (!ts.isStringLiteral(title)) throw new Error(`${ctx.operationKey}: expected render test title`)
  model.replaceNode(outer.expression, 'it', ctx)
  model.replaceNode(title, `'${title.text.replace(' (%s)', '')}'`, ctx)
  model.removeNode(callback.parameters[0], ctx)
  const build = named(
    model,
    (node) => ts.isCallExpression(node) && node.getText() === 'build(locale)',
    'render case build(locale) call',
    ctx,
    callback
  )
  model.replaceNode(build.arguments[0], `'${locale}'`, ctx)
  const expected = named(
    model,
    (node) => ts.isElementAccessExpression(node) && node.getText() === 'expectedWord[locale]',
    'render case localized expectation',
    ctx,
    callback
  )
  model.replaceNode(expected, 'expectedWord', ctx)
}

function rewriteRenderSuite(model, locale, ctx) {
  const suite = renderSuiteNode(model, ctx)
  const callback = named(
    model,
    (node) => ts.isArrowFunction(node) && node.parameters[0]?.getText().includes('expectedWord'),
    'describe.each render callback',
    ctx
  )
  const binding = named(
    model,
    (node) => ts.isBindingElement(node) && node.propertyName?.getText() === 'expect',
    'expectedWord binding',
    ctx,
    callback
  )
  model.replaceNode(binding, 'expectedWord', ctx)
  const parameterized = callback.body.statements.filter(
    (node) => ts.isExpressionStatement(node) && node.getText().startsWith('it.each<Locale>')
  )
  if (parameterized.length !== 2) {
    throw new Error(`${ctx.operationKey}: expected two parameterized render tests`)
  }
  for (const statement of parameterized) rewriteParameterizedTest(model, statement, locale, ctx)

  const fallback = named(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'it' &&
      node.arguments[0]?.text === 'falls back to the base locale (English) when locale is omitted',
    'render fallback test',
    ctx
  )
  model.replaceNode(
    fallback.arguments[0],
    "'falls back to the one supported locale when locale is omitted'",
    ctx
  )
  const strings = findUniqueNode(
    model,
    (node) => ts.isStringLiteral(node) && node.text === 'Welcome',
    { ...ctx, describe: 'fallback positive expectation' },
    fallback
  )
  model.replaceNode(strings, `'${renderWord(locale)}'`, ctx)
  const other = named(
    model,
    (node) => ts.isStringLiteral(node) && node.text === 'Добро пожаловать',
    'fallback negative expectation',
    ctx,
    fallback
  )
  model.replaceNode(other, `'${renderWord(locale === 'en' ? 'ru' : 'en')}'`, ctx)
  return suite
}

function renderOperation(model, { locale }, ctx) {
  rewriteRenderDoc(model, ctx)
  replaceRenderData(model, locale, ctx)
  rewriteRenderSuite(model, locale, ctx)
}

export function registerLocaleRenderOperation(registry) {
  registry.define('locale.render-robustness-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [claim('ts:render-robustness:locale', locale)],
    adapter: renderOperation,
  })
}
