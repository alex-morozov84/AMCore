import ts from 'typescript'

import { findUniqueNode, isVariableStatementNamed } from './path-algebra-ast-query.mjs'
import { attachedJSDoc, callName, claim, localeParams } from './project-locale-ast-helpers.mjs'
import {
  otherRenderWord,
  RENDER_CASE_TYPE,
  renderCases,
  renderLocaleIds,
  renderWord,
} from './project-locale-render-cases.mjs'
import { RENDER_DOC, renderSuite } from './project-locale-render-suite.mjs'

function named(model, predicate, describe, ctx) {
  return findUniqueNode(model, predicate, { ...ctx, describe })
}

function replaceRenderType(model, ctx) {
  const type = named(
    model,
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === 'RenderCase',
    'RenderCase type',
    ctx
  )
  model.replaceNode(type, RENDER_CASE_TYPE, ctx)
}

function replaceRenderData(model, locale, ctx) {
  const cases = named(
    model,
    (node) => isVariableStatementNamed(node, 'cases'),
    'cases declaration',
    ctx
  )
  const ids = named(
    model,
    (node) => isVariableStatementNamed(node, 'localeIds'),
    'localeIds declaration',
    ctx
  )
  model.replaceNode(cases, renderCases(locale), ctx)
  model.replaceNode(ids, renderLocaleIds(locale), ctx)
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

function renderOperation(model, { locale }, ctx) {
  const first = model.sourceFile.statements[0]
  model.replaceNode(attachedJSDoc(model, first, 'render-robustness', ctx), RENDER_DOC, ctx)
  replaceRenderType(model, ctx)
  replaceRenderData(model, locale, ctx)
  const suite = renderSuiteNode(model, ctx)
  model.replaceNode(suite, renderSuite(locale, renderWord(locale), otherRenderWord(locale)), ctx)
}

export function registerLocaleRenderOperation(registry) {
  registry.define('locale.render-robustness-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [claim('ts:render-robustness:locale', locale)],
    adapter: renderOperation,
  })
}
