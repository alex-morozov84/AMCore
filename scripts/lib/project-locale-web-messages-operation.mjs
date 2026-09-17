import ts from 'typescript'

import { findUniqueNode, isVariableStatementNamed } from './path-algebra-ast-query.mjs'
import {
  absent,
  attachedJSDoc,
  callName,
  claim,
  localeParams,
  uniqueFunction,
  uniqueImport,
} from './project-locale-ast-helpers.mjs'

const CATEGORIES = {
  en: "['one', 'other']",
  ru: "['one', 'few', 'many', 'other']",
}

function describeCall(model, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'describe' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'message catalogues',
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

function rewriteSuite(model, locale, ctx) {
  const suite = describeCall(model, ctx)
  model.replaceNode(suite.arguments[0], "'message catalogue'", ctx)
  const coverage = titledTest(model, suite, 'has a catalogue for every supported locale', ctx)
  model.replaceNode(coverage.arguments[0], "'has exactly the one supported locale'", ctx)
  model.removeNode(
    findUniqueNode(
      model,
      (node) => ts.isForOfStatement(node),
      {
        ...ctx,
        describe: 'catalogue coverage loop',
      },
      coverage
    ),
    ctx
  )
  const reverse = findUniqueNode(
    model,
    (node) =>
      ts.isExpressionStatement(node) && node.getText().includes('Object.keys(catalogues).sort()'),
    { ...ctx, describe: 'reverse catalogue coverage assertion' },
    coverage
  )
  model.replaceNode(reverse, `expect(SUPPORTED_LOCALES).toEqual(['${locale}'])`, {
    ...ctx,
    includeLeadingComments: true,
  })
  model.removeNode(
    titledTest(model, suite, 'routing is derived from the shared locale contract', ctx).parent,
    ctx
  )
  model.removeNode(
    findUniqueNode(
      model,
      (node) => isVariableStatementNamed(node, 'basePaths'),
      {
        ...ctx,
        describe: 'base catalogue paths',
      },
      suite
    ),
    ctx
  )
  model.removeNode(
    titledTest(model, suite, '%s has exactly the same keys as the en source catalogue', ctx).parent,
    ctx
  )
  const empty = titledTest(model, suite, '%s has no empty message values', ctx)
  simplifyParameterizedTest(model, empty, ctx)
  const emptySource = findUniqueNode(
    model,
    (node) => node.getText() === 'catalogues[locale]',
    {
      ...ctx,
      describe: 'empty-message catalogue source',
    },
    empty
  )
  model.replaceNode(emptySource, 'catalogue', ctx)
  const plural = titledTest(model, suite, '%s supplies every required plural category', ctx)
  simplifyParameterizedTest(model, plural, ctx)
  const required = findUniqueNode(
    model,
    (node) => node.getText() === 'REQUIRED_PLURAL_CATEGORIES[locale]',
    {
      ...ctx,
      describe: 'plural categories lookup',
    },
    plural
  )
  model.replaceNode(required, 'REQUIRED_PLURAL_CATEGORIES', ctx)
  const pluralSource = findUniqueNode(
    model,
    (node) => node.getText() === 'catalogues[locale]',
    {
      ...ctx,
      describe: 'plural-message catalogue source',
    },
    plural
  )
  model.replaceNode(pluralSource, 'catalogue', ctx)
  const diagnostic = findUniqueNode(
    model,
    (node) => ts.isTemplateExpression(node),
    {
      ...ctx,
      describe: 'plural category diagnostic',
    },
    plural
  )
  model.replaceNode(diagnostic, "'no plural categories declared'", ctx)
}

function webMessages(model, { locale }, ctx) {
  const en = uniqueImport(model, '../../messages/en.json', ctx)
  const ru = uniqueImport(model, '../../messages/ru.json', ctx)
  const selected = locale === 'en' ? en : ru
  model.replaceNode(selected.importClause.name, 'catalogue', ctx)
  model.removeNode(locale === 'en' ? ru : en, ctx)
  model.removeNode(uniqueImport(model, './routing', ctx), ctx)
  model.removeNode(
    findUniqueNode(model, (node) => isVariableStatementNamed(node, 'catalogues'), {
      ...ctx,
      describe: 'catalogues declaration',
    }),
    ctx
  )
  model.removeNode(uniqueFunction(model, 'leafPaths', ctx), ctx)
  const plural = findUniqueNode(
    model,
    (node) => isVariableStatementNamed(node, 'REQUIRED_PLURAL_CATEGORIES'),
    { ...ctx, describe: 'plural categories declaration' }
  )
  const doc = attachedJSDoc(model, plural, 'CLDR plural categories', ctx)
  const nextDoc = doc
    .getText()
    .replace('that each locale must supply', 'the supported locale must supply')
    .replace(/ Russian needs[\s\S]*?checklist item\./, '')
  model.replaceNode(doc, nextDoc, ctx)
  const declaration = plural.declarationList.declarations[0]
  model.replaceNode(declaration.initializer, CATEGORIES[locale], ctx)
  model.replaceNode(declaration.type, 'string[]', ctx)
  rewriteSuite(model, locale, ctx)
}

export function registerLocaleWebMessagesOperation(registry) {
  registry.define('locale.web-messages-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:web-messages:catalogue', locale),
      absent('ts:web-messages:cross-locale-parity'),
    ],
    adapter: webMessages,
  })
}
