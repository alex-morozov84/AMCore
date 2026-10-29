import ts from 'typescript'

import { findAllNodes } from './path-algebra-ast-query.mjs'
import { objectProperty, uniqueImport } from './project-locale-ast-helpers.mjs'

const callsByPath = new Map([
  ['apps/web/src/_app/account-security/ui/client.tsx', 2],
  ['apps/web/src/_app/account-security/ui/sign-in-again-client.tsx', 1],
  ['apps/web/src/_app/console-account-security/ui/client.tsx', 1],
])

/** Drop only routing locale options; locale still belongs to authentication metadata. */
export function dropMfaLocaleNavigation(model, _params, ctx) {
  const calls = findAllNodes(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText() === 'router.replace' &&
      node.arguments.length === 2 &&
      ts.isObjectLiteralExpression(node.arguments[1])
  )
  if (calls.length !== callsByPath.get(ctx.path))
    throw new Error('MFA locale navigation shape changed')
  for (const call of calls) {
    const options = call.arguments[1]
    const property = options.properties[0]
    if (
      options.properties.length !== 1 ||
      !(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) ||
      property.name.getText() !== 'locale'
    )
      throw new Error('Unexpected MFA navigation options')
    model.removeNode(options, ctx)
  }
}

export function rewriteMfaRedirect(model, _params, ctx) {
  const navigation = uniqueImport(model, 'next/navigation', ctx)
  if (navigation.getText() !== "import { notFound } from 'next/navigation'")
    throw new Error('MFA redirect import changed')
  model.replaceNode(navigation, "import { notFound, redirect } from 'next/navigation'", ctx)
  model.removeNode(uniqueImport(model, '@/i18n/navigation', ctx), ctx)
  const locale = uniqueImport(model, 'next-intl/server', ctx)
  if (locale.getText() !== "import { getLocale } from 'next-intl/server'")
    throw new Error('MFA redirect locale import changed')
  model.removeNode(locale, ctx)
  const calls = findAllNodes(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'redirect'
  )
  if (calls.length !== 1) throw new Error('MFA redirect call changed')
  const href = objectProperty(model, calls[0].arguments[0], 'href', ctx)
  model.replaceNode(calls[0].arguments[0], href.initializer.getText(), ctx)
}
