import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import {
  absent,
  attachedJSDoc,
  claim,
  defaultFunction,
  localeParams,
  uniqueFunction,
  uniqueImport,
} from './project-locale-ast-helpers.mjs'

function removeLocaleImports(model, ctx) {
  model.removeNode(uniqueImport(model, 'next-intl/server', ctx), {
    ...ctx,
    includeTrailingBlank: true,
  })
  model.removeNode(uniqueImport(model, '@/i18n/params', ctx), ctx)
}

function authPage(model, _params, ctx) {
  removeLocaleImports(model, ctx)
  const fn = defaultFunction(model, ctx)
  const params = findUniqueNode(
    model,
    (node) => ts.isBindingElement(node) && node.name.getText() === 'params',
    { ...ctx, describe: 'route params binding' },
    fn
  )
  const property = findUniqueNode(
    model,
    (node) => ts.isPropertySignature(node) && node.name.getText() === 'params',
    { ...ctx, describe: 'route params type property' },
    fn
  )
  const locale = findUniqueNode(
    model,
    (node) => ts.isVariableDeclaration(node) && node.name.getText() === 'locale',
    { ...ctx, describe: 'resolved route locale' },
    fn
  )
  const setup = findUniqueNode(
    model,
    (node) =>
      ts.isExpressionStatement(node) && node.expression.getText() === 'setRequestLocale(locale)',
    { ...ctx, describe: 'route locale setup' },
    fn
  )
  model.removeNode(params, ctx)
  model.removeNode(property, ctx)
  model.removeNode(locale.parent.parent, ctx)
  model.removeNode(setup, ctx)
  const redirects = findAllNodes(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'redirectIfAuthenticated',
    fn
  )
  if (redirects.length > 1) throw new Error(`${ctx.operationKey}: ambiguous authenticated redirect`)
  if (redirects[0]) model.replaceNode(redirects[0].arguments[0], '', ctx)
}

function authLayout(model, _params, ctx) {
  model.removeNode(uniqueImport(model, '@/features/locale-switcher', ctx), ctx)
  const switcher = findUniqueNode(
    model,
    (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'LocaleSwitcher',
    { ...ctx, describe: 'LocaleSwitcher element' }
  )
  model.removeNode(switcher, ctx)
}

function callbackRoute(model, _params, ctx) {
  model.removeNode(uniqueImport(model, 'next-intl', ctx), { ...ctx, includeTrailingBlank: true })
  model.removeNode(uniqueImport(model, '@/i18n/routing', ctx), ctx)
  const fn = uniqueFunction(model, 'GET', ctx)
  model.removeNode(fn.parameters[1], ctx)
  const locale = findUniqueNode(
    model,
    (node) => ts.isBindingElement(node) && node.name.getText() === 'locale',
    { ...ctx, describe: 'OAuth callback locale declaration' },
    fn
  )
  model.removeNode(locale.parent.parent.parent.parent, ctx)
  const guard = findUniqueNode(
    model,
    (node) => ts.isIfStatement(node),
    {
      ...ctx,
      describe: 'OAuth callback locale guard',
    },
    fn
  )
  model.removeNode(guard, ctx)
  const exchange = findUniqueNode(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'handleOAuthExchange',
    { ...ctx, describe: 'handleOAuthExchange call' },
    fn
  )
  model.removeNode(exchange.arguments[1], ctx)
  const doc = attachedJSDoc(model, fn, 'A Route Handler, not a page', ctx)
  const nextDoc = doc
    .getText()
    .replace(/ The backend always constructs[\s\S]*?rather than trusted\./, '')
  model.replaceNode(doc, nextDoc, ctx)
}

export function registerLocaleRouteOperations(registry) {
  registry.define('locale.auth-page', {
    paramsSchema: localeParams,
    deriveSemanticWrites: () => [
      absent('ts:route:locale-imports'),
      absent('ts:route:locale-param'),
    ],
    adapter: authPage,
  })
  registry.define('locale.auth-layout', {
    paramsSchema: localeParams,
    deriveSemanticWrites: () => [absent('ts:route:LocaleSwitcher')],
    adapter: authLayout,
  })
  registry.define('locale.oauth-callback-route', {
    paramsSchema: localeParams,
    deriveSemanticWrites: () => [
      absent('ts:oauth-callback:locale-validation'),
      claim('ts:oauth-callback:arguments', ['request']),
    ],
    adapter: callbackRoute,
  })
}
