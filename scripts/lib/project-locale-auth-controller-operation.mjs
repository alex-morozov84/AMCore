import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { CONFLICT_CODES, PathAlgebraConflictError } from './path-algebra-errors.mjs'
import { claim, localeParams, testCall } from './project-locale-ast-helpers.mjs'

const PROFILE_TITLE = 'delegates to the service and returns the wrapped profile'
const NEGOTIATION_TITLE = 'passes the negotiated Accept-Language locale to the service'

function fixtureError(ctx, count) {
  const code =
    count < 3 ? CONFLICT_CODES.MISSING_SEMANTIC_NODE : CONFLICT_CODES.AMBIGUOUS_SEMANTIC_NODE
  return new PathAlgebraConflictError(code, {
    paths: [ctx.path],
    dimensions: [],
    detail: `${ctx.operationKey}: expected three typed locale fixtures, found ${count}`,
  })
}

function authControllerFixture(model, { locale }, ctx) {
  const target = testCall(model, PROFILE_TITLE, ctx)
  const fixtures = findAllNodes(
    model,
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.name.getText() === 'locale' &&
      ts.isStringLiteral(node.initializer) &&
      ['en', 'ru'].includes(node.initializer.text),
    target
  )
  if (fixtures.length !== 3) throw fixtureError(ctx, fixtures.length)
  const negotiation = testCall(model, NEGOTIATION_TITLE, ctx)
  const strings = findAllNodes(
    model,
    (node) => ts.isStringLiteral(node) && ['en-US,en;q=0.9', 'en'].includes(node.text),
    negotiation
  )
  if (strings.length !== 3) {
    findUniqueNode(model, () => false, { ...ctx, describe: 'three negotiation locale strings' })
  }
  if (locale === 'en') return
  for (const fixture of fixtures) model.replaceNode(fixture.initializer, `'${locale}'`, ctx)
  for (const node of strings) {
    const replacement = node.text.includes('US') ? 'ru-RU,ru;q=0.9' : locale
    model.replaceNode(node, `'${replacement}'`, ctx)
  }
}

export function registerLocaleAuthControllerOperation(registry) {
  registry.define('locale.auth-controller-typed-fixture', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:auth-controller-test:update-profile-locale', locale),
      claim('ts:auth-controller-test:negotiated-locale', locale),
    ],
    adapter: authControllerFixture,
  })
}
