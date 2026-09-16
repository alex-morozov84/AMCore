import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { AUTH_PAGE_BODIES } from './project-locale-auth-page-bodies.mjs'
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
  const replacement = AUTH_PAGE_BODIES[fn.name?.text]
  if (!replacement) throw new Error(`unsupported auth page function "${fn.name?.text}"`)
  model.replaceNode(fn, replacement, ctx)
}

function authLayout(model, _params, ctx) {
  model.removeNode(uniqueImport(model, '@/features/locale-switcher', ctx), ctx)
  const wrapper = findUniqueNode(
    model,
    (node) =>
      ts.isJsxElement(node) &&
      node.children.some(
        (child) => ts.isJsxSelfClosingElement(child) && child.tagName.getText() === 'LocaleSwitcher'
      ),
    { ...ctx, describe: 'auth layout wrapper containing LocaleSwitcher' }
  )
  model.replaceNode(
    wrapper,
    `<main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      {children}
    </main>`,
    ctx
  )
}

function callbackRoute(model, _params, ctx) {
  model.removeNode(uniqueImport(model, 'next-intl', ctx), { ...ctx, includeTrailingBlank: true })
  model.removeNode(uniqueImport(model, '@/i18n/routing', ctx), ctx)
  model.replaceNode(
    uniqueFunction(model, 'GET', ctx),
    `export async function GET(request: Request) {
  return handleOAuthExchange(request)
}`,
    ctx
  )
  const doc = attachedJSDoc(
    model,
    uniqueFunction(model, 'GET', ctx),
    'A Route Handler, not a page',
    ctx
  )
  model.replaceNode(
    doc,
    `/**
 * A Route Handler, not a page: cookies can only be set from a Server Action
 * or a Route Handler, never during a Server Component's render — see
 * \`oauth-exchange-handler.ts\`.
 */`,
    ctx
  )
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
