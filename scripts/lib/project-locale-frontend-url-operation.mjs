import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { callName, claim, localeParams } from './project-locale-ast-helpers.mjs'
import { LOCALIZED_URL_SUITE, PREFIX_SUITE } from './project-locale-frontend-url-bodies.mjs'

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

function frontendUrl(model, _params, ctx) {
  model.replaceNode(suite(model, 'localizedFrontendUrl', ctx), LOCALIZED_URL_SUITE, ctx)
  model.replaceNode(suite(model, 'localePathPrefix', ctx), PREFIX_SUITE, ctx)
}

export function registerLocaleFrontendUrlOperation(registry) {
  registry.define('locale.frontend-url-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: () => [claim('ts:frontend-url-test:topology', 'unprefixed')],
    adapter: frontendUrl,
  })
}
