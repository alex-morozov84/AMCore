import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { callName, claim, localeParams } from './project-locale-ast-helpers.mjs'
import { LOCALIZED_URL_SUITE, prefixSuite } from './project-locale-frontend-url-bodies.mjs'

function suite(model, title, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'describe' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === title,
    { ...ctx, describe: `describe block "${title}"` }
  )
}

function frontendUrl(model, { locale }, ctx) {
  model.replaceNode(suite(model, 'localizedFrontendUrl', ctx), LOCALIZED_URL_SUITE, ctx)
  model.replaceNode(suite(model, 'localePathPrefix', ctx), prefixSuite(locale), ctx)
}

export function registerLocaleFrontendUrlOperation(registry) {
  registry.define('locale.frontend-url-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:frontend-url-test:topology', 'unprefixed'),
      claim('ts:frontend-url-test:typed-locale', locale),
      claim('ts:frontend-url-test:multi-prefix', `/${locale}`),
    ],
    adapter: frontendUrl,
  })
}
