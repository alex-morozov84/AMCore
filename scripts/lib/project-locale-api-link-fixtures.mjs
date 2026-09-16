import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { normalizeRussianFixtureLiterals } from './project-locale-api-simple-fixtures.mjs'
import { callName, testCall } from './project-locale-ast-helpers.mjs'

function replaceRussianAccesses(model, locale, ctx) {
  const names = findAllNodes(
    model,
    (node) =>
      ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) && node.name.text === 'ru'
  ).map((access) => access.name)
  for (const name of names) model.replaceNode(name, locale, ctx)
}

function statement(model, root, text, ctx) {
  return findUniqueNode(
    model,
    (node) => ts.isExpressionStatement(node) && node.getText().includes(text),
    { ...ctx, describe: `assertion containing "${text}"` },
    root
  )
}

export function rewriteEmailDeliverer(model, locale, ctx) {
  normalizeRussianFixtureLiterals(model, locale, ctx)
  replaceRussianAccesses(model, locale, ctx)
  const test = testCall(
    model,
    'adds a CTA to the trusted app base when the notification carries an action',
    ctx
  )
  const target = findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'objectContaining' &&
      node.getText().includes("actionUrl: 'https://app.example/ru'"),
    { ...ctx, describe: 'localized email action URL expectation' },
    test
  )
  model.replaceNode(
    target,
    `// Single-locale mode: no locale segment at all on the trusted app CTA link.
      expect.objectContaining({ actionUrl: 'https://app.example' })`,
    { ...ctx, includeLeadingComments: true }
  )
}

export function rewriteInviteService(model, locale, ctx) {
  normalizeRussianFixtureLiterals(model, locale, ctx)
  const test = testCall(
    model,
    'sends an org invite email with hasAccount=true for a known non-member',
    ctx
  )
  const regex = findUniqueNode(
    model,
    (node) => ts.isRegularExpressionLiteral(node) && node.text.includes('/ru\\/invite'),
    { ...ctx, describe: 'locale-prefixed invite URL regex' },
    test
  )
  model.replaceNode(regex, '/^https:\\/\\/app\\.example\\.com\\/invite\\/accept\\?token=.+/', ctx)
  const fallback = testCall(
    model,
    'sends an org invite email with hasAccount=false for an unknown email',
    ctx
  )
  const expectation = findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'toBe' &&
      node.expression.getText() === 'expect(data.locale).toBe' &&
      ts.isStringLiteral(node.arguments[0]) &&
      ['en', 'ru'].includes(node.arguments[0].text),
    { ...ctx, describe: 'unknown-recipient base locale expectation' },
    fallback
  )
  if (locale === 'ru') model.replaceNode(expectation.arguments[0], "'ru'", ctx)
}

export function rewriteTelegramDeliverer(model, locale, ctx) {
  normalizeRussianFixtureLiterals(model, locale, ctx)
  replaceRussianAccesses(model, locale, ctx)
  const test = testCall(
    model,
    'appends the trusted app link when the notification has a first-party action',
    ctx
  )
  const target = statement(model, test, "toContain('https://app.example/ru')", ctx)
  model.replaceNode(
    target,
    `// Single-locale mode: no locale segment — anchor on the boundary so a
    // future regression back to a prefixed link would still be caught.
    expect(client.sendMessage.mock.calls[0]![0].text).toMatch(/https:\\/\\/app\\.example(?![\\w/])/)`,
    { ...ctx, includeLeadingComments: true }
  )
}
