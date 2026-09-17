import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { callName, testCall } from './project-locale-ast-helpers.mjs'

export function rewritePasswordDefinition(model, locale, ctx) {
  const email = testCall(
    model,
    'renders detailed email copy from the projection in both locales',
    ctx
  )
  model.replaceNode(email.arguments[0], "'renders detailed email copy from the projection'", ctx)
  removeOtherLocaleStatements(model, email, locale, ctx)
  const inApp = testCall(
    model,
    'renders a neutral in-app title/body without exposing the payload',
    ctx
  )
  const assertions = findAllNodes(model, (node) => ts.isExpressionStatement(node), inApp)
  const other = assertions.find((node) =>
    node.getText().includes(`'${locale === 'en' ? 'ru' : 'en'}'`)
  )
  if (!other) throw new Error('password definition discarded in-app assertion is missing')
  model.removeNode(other, ctx)
}

function removeOtherLocaleStatements(model, test, locale, ctx) {
  const other = locale === 'en' ? 'ru' : 'en'
  const declaration = findUniqueNode(
    model,
    (node) => ts.isVariableStatement(node) && node.getText().includes(`const ${other} =`),
    { ...ctx, describe: `unselected ${other} email rendering` },
    test
  )
  model.removeNode(declaration, ctx)
  const assertions = findAllNodes(
    model,
    (node) => ts.isExpressionStatement(node) && node.getText().startsWith(`expect(${other}.`),
    test
  )
  if (assertions.length !== 2) throw new Error(`expected two ${other} email assertions`)
  for (const assertion of assertions) model.removeNode(assertion, ctx)
}

export function rewriteRegistryDefinition(model, locale, ctx) {
  const target = testCall(model, 'renders localized in-app content', ctx)
  const assertions = findAllNodes(
    model,
    (node) => ts.isExpressionStatement(node) && node.getText().includes('def.renderInApp'),
    target
  )
  if (assertions.length !== 2) throw new Error('notification registry locale assertions drifted')
  const discarded = assertions.find((node) =>
    node.getText().includes(`'${locale === 'en' ? 'ru' : 'en'}'`)
  )
  if (!discarded) throw new Error('notification registry discarded locale assertion is missing')
  model.removeNode(discarded, ctx)
  rewriteStoredFixtures(model, locale, ctx)
}

function storedSuite(model, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'describe' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'renderStored (version-aware, fail-closed)',
    { ...ctx, describe: 'renderStored describe block' }
  )
}

function rewriteStoredFixtures(model, locale, ctx) {
  const suite = storedSuite(model, ctx)
  const calls = findAllNodes(
    model,
    (node) => ts.isCallExpression(node) && callName(node) === 'renderStored',
    suite
  )
  if (calls.length !== 5) throw new Error(`expected five renderStored calls, found ${calls.length}`)
  for (const call of calls) {
    const argument = call.arguments.at(-1)
    if (!argument || !ts.isStringLiteral(argument) || !['en', 'ru'].includes(argument.text)) {
      throw new Error('renderStored supported-locale argument drifted')
    }
    model.replaceNode(argument, `'${locale}'`, ctx)
  }
  const known = testCall(model, 'renders a known type at the matching schemaVersion', ctx)
  const title = findUniqueNode(
    model,
    (node) => ts.isStringLiteral(node) && node.text === 'Profile updated',
    { ...ctx, describe: 'known renderStored title expectation' },
    known
  )
  model.replaceNode(title, `'${locale === 'en' ? 'Profile updated' : 'Профиль обновлён'}'`, ctx)
}
