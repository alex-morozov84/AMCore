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

function rewriteProxyDoc(model, doc, ctx) {
  const after = doc
    .getText()
    .replace(
      /Track 3 PR2[^\n]*\n \* CSP nonce and composes it with next-intl's locale routing\./,
      'Generates a per-request CSP nonce and forwards it to the Next renderer.'
    )
    .replace(/\n \* Composition with next-intl,[\s\S]*?completeness\/observability\.\n \*/, '\n *')
    .replace(/Framework constraint this exists to satisfy \([^)]*\):/, 'Framework constraint:')
    .replace(
      / Found by\n \* Agent 2[\s\S]*?hostile-inbound-header regression test\./,
      ' The hostile-inbound-header regression test covers this invariant.'
    )
  if (after === doc.getText() || /next-intl|ai\/models-talk/.test(after)) {
    throw new Error(`${ctx.operationKey}: proxy documentation projection failed`)
  }
  model.replaceNode(doc, after, ctx)
}

function rewriteMatcherComment(model, matcher, ctx) {
  const text = `// Cover rendered routes while excluding Next internals, the API proxy,
  // and paths with file extensions. This keeps CSP nonce/header/reporting
  // guarantees on every rendered single-locale route.
  ${matcher.getText()}`
  model.replaceNode(matcher, text, { ...ctx, includeLeadingComments: true })
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
  rewriteProxyDoc(model, doc, ctx)
  model.replaceNode(
    response.initializer,
    `NextResponse.next({\n    request: {\n      headers: request.headers,\n    },\n  })`,
    ctx
  )
  rewriteMatcherComment(model, matcher, ctx)
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
