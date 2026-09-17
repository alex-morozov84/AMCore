import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { callName, claim, localeParams, testCall } from './project-locale-ast-helpers.mjs'

const TITLE = 'accepts supported locales and rejects others'
const UPSTREAM_LOCALES = ['en', 'ru']

function localeExpectation(model, target, locale, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'toBe' &&
      node.expression
        .getText()
        .includes(`supportedLocaleSchema.safeParse('${locale}').success`) &&
      node.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword,
    { ...ctx, describe: `${locale} supported-locale expectation` },
    target
  )
}

function supportedSchemaTest(model, { locale }, ctx) {
  const target = testCall(model, TITLE, ctx)
  const expectations = new Map(
    UPSTREAM_LOCALES.map((candidate) => [
      candidate,
      localeExpectation(model, target, candidate, ctx),
    ])
  )
  const other = UPSTREAM_LOCALES.find((candidate) => candidate !== locale)
  model.replaceNode(expectations.get(other).arguments[0], 'false', ctx)
}

export function registerLocaleSupportedSchemaOperation(registry) {
  registry.define('locale.supported-schema-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:supported-schema-test:selected-accepted', locale),
      claim(
        'ts:supported-schema-test:other-rejected',
        UPSTREAM_LOCALES.find((candidate) => candidate !== locale)
      ),
    ],
    adapter: supportedSchemaTest,
  })
}
