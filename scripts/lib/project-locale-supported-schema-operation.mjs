import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { callName, claim, localeParams, testCall } from './project-locale-ast-helpers.mjs'

const TITLE = 'accepts supported locales and rejects others'

function englishExpectation(model, target, ctx) {
  return findUniqueNode(
    model,
    (node) =>
      ts.isCallExpression(node) &&
      callName(node) === 'toBe' &&
      node.expression.getText().includes("supportedLocaleSchema.safeParse('en').success") &&
      node.arguments[0]?.kind === ts.SyntaxKind.TrueKeyword,
    { ...ctx, describe: 'English supported-locale expectation' },
    target
  )
}

function supportedSchemaTest(model, { locale }, ctx) {
  const target = testCall(model, TITLE, ctx)
  const expectation = englishExpectation(model, target, ctx)
  if (locale === 'ru') model.replaceNode(expectation.arguments[0], 'false', ctx)
}

export function registerLocaleSupportedSchemaOperation(registry) {
  registry.define('locale.supported-schema-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:supported-schema-test:english-supported', locale === 'en'),
    ],
    adapter: supportedSchemaTest,
  })
}
