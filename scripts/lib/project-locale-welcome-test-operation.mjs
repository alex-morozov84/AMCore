import ts from 'typescript'

import { findUniqueNode } from './path-algebra-ast-query.mjs'
import { absent, claim, localeParams, testCall } from './project-locale-ast-helpers.mjs'

const WORD = { en: 'Welcome', ru: 'Добро пожаловать' }

function welcomeTest(model, { locale }, ctx) {
  const base = testCall(model, 'should render in the base locale (English) by default', ctx)
  model.replaceNode(
    base.arguments[0],
    "'should render in the base (and only) supported locale by default'",
    ctx
  )
  const word = findUniqueNode(
    model,
    (node) => ts.isStringLiteral(node) && node.text === 'Welcome',
    { ...ctx, describe: 'default welcome chrome' },
    base
  )
  model.replaceNode(word, `'${WORD[locale]}'`, ctx)
  const content = findUniqueNode(
    model,
    (node) =>
      ts.isExpressionStatement(node) && node.getText().includes("toContain('Alexander Morozov')"),
    { ...ctx, describe: 'welcome localized-content assertion' },
    base
  )
  model.replaceNode(content, `// Check localized content\n    ${content.getText()}`, {
    ...ctx,
    includeLeadingComments: true,
  })
  model.removeNode(testCall(model, 'should render in Russian when locale=ru', ctx), ctx)
}

export function registerLocaleWelcomeTestOperation(registry) {
  registry.define('locale.welcome-email-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:welcome-email-test:default-locale', locale),
      absent('ts:welcome-email-test:secondary-locale'),
    ],
    adapter: welcomeTest,
  })
}
