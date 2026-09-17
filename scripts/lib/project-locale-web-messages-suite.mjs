import ts from 'typescript'

import { findUniqueNode, isVariableStatementNamed } from './path-algebra-ast-query.mjs'
import { callName } from './project-locale-ast-helpers.mjs'

function describeCall(model, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'describe' &&
      node.arguments[0]?.text === 'message catalogues',
    { ...ctx, describe: 'message catalogues describe block' }
  )
}

function titledTest(model, suite, title, ctx) {
  return findUniqueNode(
    model,
    (node) => ts.isCallExpression(node) && node.arguments[0]?.text === title,
    { ...ctx, describe: `test "${title}"` },
    suite
  )
}

function simplifyParameterizedTest(model, test, ctx) {
  const callback = test.arguments[1]
  if (!ts.isArrowFunction(callback) || callback.parameters.length !== 1) {
    throw new Error(`${ctx.operationKey}: expected one locale callback parameter`)
  }
  model.replaceNode(test.expression, 'it', ctx)
  model.replaceNode(test.arguments[0], `'${test.arguments[0].text.replace('%s ', '')}'`, ctx)
  model.removeNode(callback.parameters[0], ctx)
}

function rewriteCoverage(model, suite, locale, ctx) {
  const test = titledTest(model, suite, 'has a catalogue for every supported locale', ctx)
  model.replaceNode(test.arguments[0], "'has exactly the one supported locale'", ctx)
  const loop = findUniqueNode(model, (node) => ts.isForOfStatement(node), ctx, test)
  model.removeNode(loop, ctx)
  const assertion = findUniqueNode(
    model,
    (node) =>
      ts.isExpressionStatement(node) && node.getText().includes('Object.keys(catalogues).sort()'),
    { ...ctx, describe: 'reverse catalogue coverage assertion' },
    test
  )
  model.replaceNode(assertion, `expect(SUPPORTED_LOCALES).toEqual(['${locale}'])`, {
    ...ctx,
    includeLeadingComments: true,
  })
}

function simplifyCatalogueTest(model, test, lookup, ctx) {
  simplifyParameterizedTest(model, test, ctx)
  const source = findUniqueNode(
    model,
    (node) => node.getText() === 'catalogues[locale]',
    { ...ctx, describe: `${lookup} catalogue source` },
    test
  )
  model.replaceNode(source, 'catalogue', ctx)
}

export function rewriteMessageSuite(model, locale, ctx) {
  const suite = describeCall(model, ctx)
  model.replaceNode(suite.arguments[0], "'message catalogue'", ctx)
  rewriteCoverage(model, suite, locale, ctx)
  model.removeNode(
    titledTest(model, suite, 'routing is derived from the shared locale contract', ctx).parent,
    ctx
  )
  const basePaths = findUniqueNode(
    model,
    (node) => isVariableStatementNamed(node, 'basePaths'),
    { ...ctx, describe: 'base catalogue paths' },
    suite
  )
  model.removeNode(basePaths, ctx)
  const parity = titledTest(
    model,
    suite,
    '%s has exactly the same keys as the en source catalogue',
    ctx
  )
  model.removeNode(parity.parent, ctx)
  simplifyCatalogueTest(
    model,
    titledTest(model, suite, '%s has no empty message values', ctx),
    'empty-message',
    ctx
  )
  const plural = titledTest(model, suite, '%s supplies every required plural category', ctx)
  simplifyCatalogueTest(model, plural, 'plural-message', ctx)
  const required = findUniqueNode(
    model,
    (node) => node.getText() === 'REQUIRED_PLURAL_CATEGORIES[locale]',
    { ...ctx, describe: 'plural categories lookup' },
    plural
  )
  model.replaceNode(required, 'REQUIRED_PLURAL_CATEGORIES', ctx)
  const diagnostic = findUniqueNode(
    model,
    (node) => ts.isTemplateExpression(node),
    { ...ctx, describe: 'plural category diagnostic' },
    plural
  )
  model.replaceNode(diagnostic, "'no plural categories declared'", ctx)
}
