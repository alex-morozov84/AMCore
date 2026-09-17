import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { objectProperty } from './project-locale-ast-helpers.mjs'
import { mockCall } from './project-locale-navigation-test-core.mjs'

function mockObject(model, call, ctx) {
  return findUniqueNode(
    model,
    (node) => ts.isObjectLiteralExpression(node),
    { ...ctx, describe: 'mock factory object' },
    call.arguments[1]
  )
}

function addPathnameMock(model, object, ctx) {
  const source = object.getText()
  if (!source.startsWith('{')) throw new Error(`${ctx.operationKey}: expected mock object literal`)
  model.replaceNode(object, source.replace('{', '{\n  usePathname: () => pathname(),'), ctx)
}

export function rewriteBarTest(model, ctx) {
  const locale = mockCall(model, '@/i18n/navigation', ctx)
  model.removeNode(locale.parent, { ...ctx, includeLeadingBlank: true })
  const next = mockObject(model, mockCall(model, 'next/navigation', ctx), ctx)
  addPathnameMock(model, next, ctx)
}

export function rewriteLinkTest(model, ctx) {
  const localeCall = mockCall(model, '@/i18n/navigation', ctx)
  model.replaceNode(localeCall.arguments[0], `'next/link'`, ctx)
  const localeObject = mockObject(model, localeCall, ctx)
  model.removeNode(objectProperty(model, localeObject, 'usePathname', ctx), ctx)
  const link = objectProperty(model, localeObject, 'Link', ctx)
  model.replaceNode(link.name, 'default', ctx)
  const next = mockObject(model, mockCall(model, 'next/navigation', ctx), ctx)
  addPathnameMock(model, next, ctx)
}

function authenticationCalls(model) {
  return findAllNodes(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'redirectIfAuthenticated'
  )
}

function redirectAssertions(model) {
  return findAllNodes(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText().endsWith('toHaveBeenCalledWith') &&
      ts.isObjectLiteralExpression(node.arguments[0])
  )
}

function rewriteRedirectAssertions(model, ctx) {
  const objects = redirectAssertions(model)
  if (objects.length !== 2)
    throw new Error(`expected two redirect object assertions, found ${objects.length}`)
  for (const call of objects) {
    const href = objectProperty(model, call.arguments[0], 'href', ctx).initializer.getText()
    model.replaceNode(call.arguments[0], href, ctx)
  }
}

export function rewriteGatingTest(model, ctx) {
  const imported = findUniqueNode(
    model,
    (node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === '@/i18n/navigation',
    { ...ctx, describe: 'locale redirect import' }
  )
  const vitest = findUniqueNode(
    model,
    (node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'vitest',
    { ...ctx, describe: 'Vitest import' }
  )
  model.replaceNode(vitest, `import { redirect } from 'next/navigation'\n${vitest.getText()}`, ctx)
  model.removeNode(imported, ctx)
  model.removeNode(mockCall(model, 'next-intl/server', ctx).parent, ctx)
  model.replaceNode(
    mockCall(model, '@/i18n/navigation', ctx).arguments[0],
    `'next/navigation'`,
    ctx
  )
  for (const call of authenticationCalls(model)) {
    if (call.arguments.length) model.removeNode(call.arguments[0], ctx)
  }
  rewriteRedirectAssertions(model, ctx)
}
