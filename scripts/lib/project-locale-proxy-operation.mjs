import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import {
  absent,
  attachedJSDoc,
  claim,
  defaultFunction,
  uniqueImport,
  uniqueVariable,
} from './project-locale-ast-helpers.mjs'

const paramsSchema = (params) =>
  params !== null &&
  typeof params === 'object' &&
  Object.keys(params).length === 2 &&
  ['en', 'ru'].includes(params.locale) &&
  params.topology === 'single-unprefixed'

const PROXY_DOC = `/**
 * Generates a per-request CSP nonce and forwards it to the Next renderer.
 *
 * Mutating the original request headers preserves the request identity used by
 * Next's test-mode interception. Both possible inbound CSP headers are cleared
 * before the active policy is installed so a hostile header cannot win Next's
 * nonce-selection order.
 *
 * Next reads its nonce from the request CSP header. The pass-through response
 * therefore forwards the mutated headers through \`request: { headers }\`; the
 * response receives the same policy separately for the browser.
 */`

const MATCHER = `// Cover rendered routes while excluding Next internals, the API proxy,
  // and paths with file extensions. This keeps CSP nonce/header/reporting
  // guarantees on every rendered single-locale route.
  matcher: ['/((?!api|_next|_vercel|.*\\\\..*).*)']`

function uniqueMatcher(model, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'matcher' &&
      node.initializer.getText() === "['/((?!api|_next|_vercel|.*\\\\..*).*)']",
    { ...ctx, describe: 'unchanged proxy matcher' }
  )
}

function responseDeclaration(model, ctx) {
  const response = uniqueVariable(model, ['response'], ctx)
  const call = response.initializer
  if (
    !call ||
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== 'handleI18nRouting' ||
    call.arguments.length !== 1 ||
    call.arguments[0].getText() !== 'request'
  ) {
    throw new Error(`${ctx.operationKey}: expected response from handleI18nRouting(request)`)
  }
  return response
}

function proxyOperation(model, _params, ctx) {
  const nextServer = uniqueImport(model, 'next/server', ctx)
  const intl = uniqueImport(model, 'next-intl/middleware', ctx)
  const routing = uniqueImport(model, './i18n/routing', ctx)
  const handler = uniqueVariable(model, ['handleI18nRouting'], ctx)
  const response = responseDeclaration(model, ctx)
  const proxy = defaultFunction(model, ctx)
  const doc = attachedJSDoc(model, proxy, 'generates a per-request', ctx)
  const matcher = uniqueMatcher(model, ctx)

  if (nextServer.getText() !== "import type { NextRequest } from 'next/server'") {
    throw new Error(`${ctx.operationKey}: expected type-only NextRequest import`)
  }
  if (handler.initializer?.getText() !== 'createMiddleware(routing)') {
    throw new Error(`${ctx.operationKey}: expected createMiddleware(routing) declaration`)
  }

  model.replaceNode(nextServer, "import { type NextRequest, NextResponse } from 'next/server'", ctx)
  model.removeNode(intl, ctx)
  model.removeNode(routing, ctx)
  model.removeNode(handler.parent.parent, ctx)
  model.replaceNode(doc, PROXY_DOC, ctx)
  model.replaceNode(
    response.initializer,
    `NextResponse.next({\n    request: {\n      headers: request.headers,\n    },\n  })`,
    ctx
  )
  model.replaceNode(matcher, MATCHER, { ...ctx, includeLeadingComments: true })
}

export function registerLocaleProxyOperation(registry) {
  registry.define('locale.proxy-i18n-seam', {
    paramsSchema,
    deriveSemanticWrites: () => [
      absent('ts:proxy:i18n-middleware'),
      claim('ts:proxy:csp-request-propagation', 'request.headers'),
      claim('ts:proxy:csp-response-header', 'retained'),
      claim('ts:proxy:reporting-endpoint', 'retained'),
      claim('ts:proxy:matcher', '/((?!api|_next|_vercel|.*\\..*).*)'),
    ],
    adapter: proxyOperation,
  })
}
