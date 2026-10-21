import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import {
  absent,
  localeParams,
  uniqueFunction,
  uniqueImport,
} from './project-locale-ast-helpers.mjs'

function completionPage(model, _params, ctx) {
  const imported = uniqueImport(model, '@/i18n/params', ctx)
  const mount = uniqueImport(model, '@/_app/auth-completion', ctx)
  model.replaceNode(mount, "import { DEFAULT_LOCALE } from '@amcore/shared'\n", ctx)
  model.replaceNode(imported, mount.getText(), ctx)
  const resolve = findUniqueNode(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'resolveLocaleParam',
    ctx
  )
  model.replaceNode(resolve.parent, 'DEFAULT_LOCALE', ctx)
  for (const name of ['params']) {
    const binding = findUniqueNode(
      model,
      (node) => ts.isBindingElement(node) && node.name.getText() === name,
      ctx
    )
    const property = findUniqueNode(
      model,
      (node) => ts.isPropertySignature(node) && node.name.getText() === name,
      ctx
    )
    model.removeNode(binding, ctx)
    model.removeNode(property, ctx)
  }
}

function legacyRoute(model, _params, ctx) {
  const imported = uniqueImport(model, '@/_app/product-admin', ctx)
  model.replaceNode(
    imported,
    "import { DEFAULT_LOCALE } from '@amcore/shared'\n\n" + imported.getText(),
    ctx
  )
  const locale = findUniqueNode(
    model,
    (node) => ts.isPropertySignature(node) && node.name.getText() === 'locale',
    ctx
  )
  const call = findUniqueNode(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'legacyAdminRedirect',
    ctx
  )
  const argument = call.arguments[2]
  if (locale.parent.members.length === 1) {
    model.replaceNode(argument, '{ locale: DEFAULT_LOCALE }', ctx)
    model.removeNode(uniqueFunction(model, 'GET', ctx).parameters[1], ctx)
  } else {
    model.replaceNode(argument, `{ ...(${argument.getText()}), locale: DEFAULT_LOCALE }`, ctx)
    model.removeNode(locale, ctx)
  }
}

export function registerLocaleAdminRouteOperations(registry) {
  for (const [key, adapter] of [
    ['locale.completion-page', completionPage],
    ['locale.legacy-admin-route', legacyRoute],
  ]) {
    registry.define(key, {
      paramsSchema: localeParams,
      deriveSemanticWrites: () => [absent('ts:admin-route:locale-param')],
      adapter,
    })
  }
}
