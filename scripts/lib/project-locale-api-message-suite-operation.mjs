import ts from 'typescript'

import { findUniqueNode, isVariableStatementNamed } from './path-algebra-ast-query.mjs'
import { attachedJSDoc } from './project-locale-ast-helpers.mjs'
import { describeCall } from './project-locale-api-suite-helpers.mjs'

const declaration = (model, root, name, ctx) =>
  findUniqueNode(
    model,
    (node) => isVariableStatementNamed(node, name),
    {
      ...ctx,
      describe: `${name} declaration`,
    },
    root
  )

const titledTest = (model, root, title, ctx) =>
  findUniqueNode(
    model,
    (node) => ts.isCallExpression(node) && node.arguments[0]?.text === title,
    {
      ...ctx,
      describe: `test "${title}"`,
    },
    root
  )

function rewriteDoc(model, suite, ctx) {
  const doc = attachedJSDoc(model, suite.parent, 'i18n parity guard', ctx)
  const after = doc
    .getText()
    .replace('i18n parity guard', 'i18n completeness guard')
    .replace(
      /The real risk is a key[\s\S]*?same set of message ids\./,
      'With one supported locale, this proves that the selected catalogue is complete.'
    )
  model.replaceNode(doc, after, ctx)
}

function rewriteEmptyTest(model, suite, ctx) {
  const test = titledTest(model, suite, 'has no empty message values in either locale', ctx)
  model.replaceNode(test.arguments[0], "'has no empty message values'", ctx)
  const outer = findUniqueNode(
    model,
    (node) =>
      ts.isForOfStatement(node) && node.expression.getText() === 'Object.entries(emailMessages)',
    { ...ctx, describe: 'cross-locale empty-message loop' },
    test
  )
  const inner = findUniqueNode(
    model,
    (node) => ts.isForOfStatement(node) && node !== outer,
    {
      ...ctx,
      describe: 'per-catalogue empty-message loop',
    },
    outer
  )
  model.replaceNode(outer, inner.getText().replace('`${locale}.${id}`', 'id'), ctx)
}

function rewritePluralTest(model, suite, locale, ctx) {
  const categories = declaration(model, suite, 'REQUIRED_PLURAL_CATEGORIES', ctx)
  const values = locale === 'en' ? "['one', 'other']" : "['one', 'few', 'many', 'other']"
  model.replaceNode(categories.declarationList.declarations[0].initializer, values, ctx)
  model.replaceNode(categories.declarationList.declarations[0].type, 'string[]', ctx)
  const doc = attachedJSDoc(model, categories, 'CLDR plural categories', ctx)
  model.replaceNode(doc, doc.getText().replace(/each locale/, 'the supported locale'), ctx)
  const test = titledTest(
    model,
    suite,
    'supplies every required plural category in each locale',
    ctx
  )
  model.replaceNode(test.arguments[0], "'supplies every required plural category'", ctx)
  const outer = findUniqueNode(
    model,
    (node) =>
      ts.isForOfStatement(node) && node.expression.getText() === 'Object.entries(emailMessages)',
    { ...ctx, describe: 'cross-locale plural loop' },
    test
  )
  const inner = findUniqueNode(
    model,
    (node) => ts.isForOfStatement(node) && node.expression.getText() === 'Object.entries(messages)',
    { ...ctx, describe: 'per-catalogue plural loop' },
    outer
  )
  model.replaceNode(
    outer,
    inner.getText().replace('required!', 'REQUIRED_PLURAL_CATEGORIES').replace('${locale}.', ''),
    ctx
  )
}

export function messageSuite(model, { locale }, ctx) {
  const suite = describeCall(model, 'emailMessages i18n parity', ctx)
  rewriteDoc(model, suite, ctx)
  model.replaceNode(suite.arguments[0], "'emailMessages i18n completeness'", ctx)
  const selected = declaration(model, suite, locale === 'en' ? 'enKeys' : 'ruKeys', ctx)
  const other = declaration(model, suite, locale === 'en' ? 'ruKeys' : 'enKeys', ctx)
  model.replaceNode(selected, `const messages = emailMessages.${locale}`, ctx)
  model.removeNode(other, ctx)
  model.removeNode(
    titledTest(model, suite, 'ru and en define exactly the same message ids', ctx).parent,
    ctx
  )
  rewriteEmptyTest(model, suite, ctx)
  rewritePluralTest(model, suite, locale, ctx)
  const pluralized = declaration(model, suite, 'pluralized', ctx)
  const source = findUniqueNode(
    model,
    (node) => ts.isPropertyAccessExpression(node) && node.getText() === 'emailMessages.ru',
    { ...ctx, describe: 'pluralized message source' },
    pluralized
  )
  model.replaceNode(source, 'messages', ctx)
}
