import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { callName, testCall } from './project-locale-ast-helpers.mjs'

export function mockCall(model, moduleName, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText() === 'vi.mock' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === moduleName,
    { ...ctx, describe: `vi.mock('${moduleName}') call` }
  )
}

export function removeMock(model, moduleName, ctx) {
  model.removeNode(mockCall(model, moduleName, ctx).parent, ctx)
}

export function rewriteOAuthTest(model, ctx) {
  const calls = findAllNodes(
    model,
    (node) => ts.isCallExpression(node) && callName(node) === 'handleOAuthExchange'
  )
  if (calls.length !== 6)
    throw new Error(`expected six OAuth exchange calls, found ${calls.length}`)
  for (const call of calls) {
    if (call.arguments.length !== 2) throw new Error('OAuth exchange test arguments drifted')
    model.removeNode(call.arguments[1], ctx)
  }
  const paths = findAllNodes(
    model,
    (node) => ts.isStringLiteral(node) && /^(en|ru)\/auth\/callback/.test(node.text)
  )
  for (const literal of paths)
    model.replaceNode(literal, `'${literal.text.replace(/^(en|ru)\//, '')}'`, ctx)
  const expected = findAllNodes(
    model,
    (node) => ts.isStringLiteral(node) && /^\/(en|ru)(\/login)?$/.test(node.text)
  )
  for (const literal of expected) {
    model.replaceNode(literal, literal.text.endsWith('/login') ? "'/login'" : "'/'", ctx)
  }
}

export function rewriteEslintGuards(model, ctx) {
  const removed = [
    'bans locale-unaware navigation imports',
    'bans locale-unaware navigation hooks',
    'bans importing Link straight from @/i18n/navigation',
    'leaves compliant code alone',
    'still bans layer barrels inside the navigation source file',
  ]
  for (const title of removed) model.removeNode(testCall(model, title, ctx), ctx)
  const literal = findUniqueNode(
    model,
    (node) => ts.isStringLiteral(node) && node.text === "'@/features/locale-switcher'",
    { ...ctx, describe: 'locale-switcher FSD fixture literal' }
  )
  model.replaceNode(literal, `"'@/features/auth-logout'"`, ctx)
}

export function rewriteOptionalDalTest(model, ctx) {
  removeMock(model, 'next-intl/server', ctx)
  removeMock(model, '@/i18n/navigation', ctx)
}

export function rewriteRouterTest(model, ctx) {
  model.replaceNode(
    mockCall(model, '@/i18n/navigation', ctx).arguments[0],
    `'next/navigation'`,
    ctx
  )
  const pushTest = testCall(model, 'starts the controller and delegates on push', ctx)
  const calls = findAllNodes(
    model,
    (node) =>
      ts.isCallExpression(node) && ['push', 'toHaveBeenCalledWith'].includes(callName(node)),
    pushTest
  ).filter((call) => call.arguments.length === 2)
  if (calls.length !== 2) throw new Error('route-progress push assertions drifted')
  for (const call of calls) model.removeNode(call.arguments[1], ctx)
}
