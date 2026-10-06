import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { absent, localeParams, uniqueImport } from './project-locale-ast-helpers.mjs'

function invitationRoute(model, _params, ctx) {
  const localeImport = uniqueImport(model, '@/i18n/params', ctx)
  const fn = findUniqueNode(model, (node) => ts.isFunctionDeclaration(node), ctx)
  const resolve = findUniqueNode(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'resolveLocaleParam',
    ctx,
    fn
  )
  const localeType = findUniqueNode(
    model,
    (node) => ts.isPropertySignature(node) && node.name.getText() === 'locale',
    ctx,
    fn
  )
  if (fn.name?.text === 'GET') {
    const handlerImport = uniqueImport(model, '@/_app/invitation-flow/index.server', ctx)
    model.replaceNode(handlerImport, "import { DEFAULT_LOCALE } from '@amcore/shared'\n", ctx)
    model.replaceNode(localeImport, handlerImport.getText(), ctx)
    if (fn.body.statements.length === 1) {
      model.removeNode(fn.parameters[1], ctx)
      model.replaceNode(resolve.parent, 'DEFAULT_LOCALE', ctx)
      return
    }
  } else {
    model.removeNode(localeImport, ctx)
    model.removeNode(uniqueImport(model, 'next-intl/server', ctx), ctx)
    const setup = findUniqueNode(
      model,
      (node) =>
        ts.isExpressionStatement(node) && node.expression.getText() === 'setRequestLocale(locale)',
      ctx,
      fn
    )
    model.removeNode(setup, ctx)
  }
  const binding = findUniqueNode(
    model,
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements[0].getText() === 'locale',
    ctx,
    fn
  )
  if (binding.name.elements.length !== 2 || !ts.isAwaitExpression(binding.initializer)) {
    throw new Error(`${ctx.operationKey}: unexpected invitation locale binding`)
  }
  const all = binding.initializer.expression
  if (
    !ts.isCallExpression(all) ||
    all.expression.getText() !== 'Promise.all' ||
    !ts.isArrayLiteralExpression(all.arguments[0]) ||
    all.arguments[0].elements.length !== 2
  ) {
    throw new Error(`${ctx.operationKey}: unexpected invitation params resolution`)
  }
  model.replaceNode(
    binding,
    `${binding.name.elements[1].getText()} = await ${all.arguments[0].elements[1].getText()}`,
    ctx
  )
  if (fn.name?.text !== 'Unusable') model.removeNode(localeType, ctx)
  if (fn.name?.text === 'GET') {
    const bootstrap = findUniqueNode(
      model,
      (node) =>
        ts.isCallExpression(node) && node.expression.getText() === 'invitationHandlers.bootstrap',
      ctx,
      fn
    )
    model.replaceNode(bootstrap.arguments[1], 'DEFAULT_LOCALE', ctx)
  } else if (fn.name?.text === 'Unusable') {
    const params = findUniqueNode(
      model,
      (node) => ts.isBindingElement(node) && node.name.getText() === 'params',
      ctx,
      fn
    )
    const property = findUniqueNode(
      model,
      (node) => ts.isPropertySignature(node) && node.name.getText() === 'params',
      ctx,
      fn
    )
    model.removeNode(params, ctx)
    model.removeNode(property, ctx)
  }
}

export function registerInvitationRouteOperation(registry) {
  registry.define('locale.invitation-route', {
    paramsSchema: localeParams,
    deriveSemanticWrites: () => [absent('ts:invitation-route:locale-param')],
    adapter: invitationRoute,
  })
}
