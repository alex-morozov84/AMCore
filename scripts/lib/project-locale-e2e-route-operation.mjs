import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { absent, claim, localeParams } from './project-locale-ast-helpers.mjs'
import {
  commentRange,
  rewriteRoutePrefixes,
  routeReferenceInventory,
} from './project-locale-e2e-route-inventory.mjs'
import { rewriteOAuthAssertions } from './project-locale-oauth-e2e-route-operation.mjs'

const paramsSchema = (params) =>
  localeParams({ locale: params?.locale }) &&
  ['web', 'oauth'].includes(params.surface) &&
  Number.isInteger(params.expectedReferences) &&
  [0, 1].includes(params.unavailableUiCases) &&
  Object.keys(params).length === 4

function removeUnavailableUiCase(model, expected, ctx) {
  const matches = findAllNodes(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      ['test', 'it'].includes(node.expression.getText()) &&
      node.getText().includes("selectOption('ru')") &&
      node.getText().includes('name: /language/i')
  )
  if (matches.length !== expected) {
    findUniqueNode(model, () => false, { ...ctx, describe: `${expected} unavailable UI cases` })
  }
  for (const node of matches) model.removeNode(node, { ...ctx, includeLeadingBlank: true })
  return matches
}

const covered = (node, ranges) =>
  ranges.some((range) => range.getStart() <= node.getStart() && node.end <= range.end)

const ROOT_URL_ASSERTIONS = new Map([
  [String.raw`/\/en\/?$/`, "'/'"],
  [String.raw`/https:\/\/app\.localhost\/en\/?$/`, "'https://app.localhost/'"],
])

function rewriteExactRootAssertions(model, ctx) {
  const matches = findAllNodes(model, (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length !== 1) return false
    const [argument] = node.arguments
    return (
      node.expression.getText().endsWith('.toHaveURL') &&
      ts.isRegularExpressionLiteral(argument) &&
      ROOT_URL_ASSERTIONS.has(argument.getText())
    )
  })
  for (const call of matches) {
    const [argument] = call.arguments
    model.replaceNode(argument, ROOT_URL_ASSERTIONS.get(argument.getText()), ctx)
  }
  return matches.map((call) => call.arguments[0])
}

function rewriteComment(text) {
  const specific = new Map([
    [
      '// The login redirect must carry the locale the account actually ends up',
      '// The login redirect must use the exact single-locale callback destination.',
    ],
    [
      '// with — not merely *some* locale. An `/(en|ru)/` assertion would pass',
      '// The stored locale remains covered independently by the account assertion.',
    ],
    ['// against a hardcoded `/en`, so this drives the real Accept-Language path', ''],
    ['// to `ru` and pins both the stored value and the redirect to it.', ''],
    [
      '// Pinned to a non-default locale on purpose. An `/(en|ru)/` pattern',
      '// The link flow must return to the exact single-locale settings destination.',
    ],
    ['// would still pass against a hardcoded `/en`, so the redirect has to', ''],
    ["// be tied to the account's actual stored locale.", ''],
  ])
  return (specific.get(text.trim()) ?? rewriteRoutePrefixes(text)).replace(
    'locale-prefix format mismatch',
    'route-format mismatch'
  )
}

function e2eRoutes(model, params, ctx) {
  const inventory = routeReferenceInventory(model)
  if (inventory.count !== params.expectedReferences) {
    throw new Error(
      `${ctx.operationKey}: expected ${params.expectedReferences} route references, found ${inventory.count}`
    )
  }
  const claimed =
    params.surface === 'oauth' ? rewriteOAuthAssertions(model, params.locale, ctx) : []
  claimed.push(...rewriteExactRootAssertions(model, ctx))
  claimed.push(...removeUnavailableUiCase(model, params.unavailableUiCases, ctx))
  for (const reference of inventory.references) {
    const node = reference.kind === 'comment' ? commentRange(reference) : reference.node
    if (covered(node, claimed) || model.isRemoved(node)) continue
    const replacement =
      reference.kind === 'comment'
        ? rewriteComment(reference.text)
        : rewriteRoutePrefixes(reference.text)
    if (replacement !== reference.text) model.replaceNode(node, replacement, ctx)
  }
}

export function registerLocaleE2eRouteOperation(registry) {
  registry.define('locale.e2e-route-topology', {
    paramsSchema,
    deriveSemanticWrites: ({ locale, surface }) => [
      claim(`ts:e2e-routes:${surface}:topology`, 'single-unprefixed'),
      ...(surface === 'oauth'
        ? [claim('ts:e2e-routes:oauth:selected-locale-fixtures', locale)]
        : []),
      absent(`ts:e2e-routes:${surface}:locale-switcher-case`),
    ],
    adapter: e2eRoutes,
  })
}
