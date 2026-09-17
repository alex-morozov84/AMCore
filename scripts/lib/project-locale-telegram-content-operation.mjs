import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { claim, localeParams, testCall } from './project-locale-ast-helpers.mjs'

const TITLE = 'renders detailed content only from the allowlisted projection (no raw payload leak)'

function callIn(model, target, ctx) {
  return findUniqueNode(
    model,
    (node) => isRenderTelegramCall(node),
    { ...ctx, describe: 'renderTelegram fixture call' },
    target
  )
}

function isRenderTelegramCall(node) {
  if (!ts.isCallExpression(node)) return false
  const called = ts.isNonNullExpression(node.expression)
    ? node.expression.expression
    : node.expression
  const argument = node.arguments.at(-1)
  return (
    ts.isPropertyAccessExpression(called) &&
    called.name.text === 'renderTelegram' &&
    argument &&
    ts.isStringLiteral(argument) &&
    ['en', 'ru'].includes(argument.text)
  )
}

function bodyFixture(model, target, ctx) {
  return findUniqueNode(
    model,
    (node) => ts.isStringLiteral(node) && ['(en)', '(ru)'].includes(node.text),
    { ...ctx, describe: 'rendered locale body fixture' },
    target
  )
}

function telegramFixture(model, { locale }, ctx) {
  const target = testCall(model, TITLE, ctx)
  const call = callIn(model, target, ctx)
  const argument = call.arguments.at(-1)
  const expectedBody = bodyFixture(model, target, ctx)
  if (locale === 'en') return
  model.replaceNode(argument, `'${locale}'`, ctx)
  model.replaceNode(expectedBody, `'(${locale})'`, ctx)
}

export function registerLocaleTelegramContentOperation(registry) {
  registry.define('locale.telegram-content-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:telegram-content-test:typed-locale', locale),
      claim('ts:telegram-content-test:rendered-locale', `(${locale})`),
    ],
    adapter: telegramFixture,
  })
}
