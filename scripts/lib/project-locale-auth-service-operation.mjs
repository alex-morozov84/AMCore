import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { absent, claim, localeParams, testCall } from './project-locale-ast-helpers.mjs'
import {
  normalizeRussianFixtureLiterals,
  rewriteAuthServiceSpecialCase,
} from './project-locale-api-simple-fixtures.mjs'

function rewriteExplicitLocaleTest(model, locale, ctx) {
  const test = testCall(model, 'uses the explicit body locale over the negotiated header', ctx)
  const register = findUniqueNode(
    model,
    (node) => ts.isCallExpression(node) && node.expression.getText() === 'authService.register',
    { ...ctx, describe: 'explicit-locale authService.register call' },
    test
  )
  const literals = findAllNodes(
    model,
    (node) => ts.isStringLiteral(node) && ['en', 'ru'].includes(node.text),
    register
  )
  for (const literal of literals) model.replaceNode(literal, `'${locale}'`, ctx)
  if (locale === 'en') return
  model.replaceNode(test.arguments[0], "'uses the explicit body locale when supplied'", ctx)
  const assertion = expressionIn(model, test, 'mockCtx.prisma.user.create', ctx)
  replaceLocaleProperty(model, assertion, 'locale', locale, ctx)
}

function replaceLocaleProperty(model, root, name, locale, ctx) {
  const property = findUniqueNode(
    model,
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.name.getText() === name &&
      ts.isStringLiteral(node.initializer) &&
      ['en', 'ru'].includes(node.initializer.text),
    { ...ctx, describe: `${name} locale fixture` },
    root
  )
  model.replaceNode(property.initializer, `'${locale}'`, ctx)
}

function rewriteFallbackLocaleTest(model, locale, ctx) {
  const test = testCall(
    model,
    'falls back to the negotiated Accept-Language locale when the body omits it',
    ctx
  )
  replaceLocaleProperty(model, test, 'acceptedLocale', locale, ctx)
  replaceLocaleProperty(model, test, 'locale', locale, ctx)
}

function expressionIn(model, root, text, ctx) {
  return findUniqueNode(
    model,
    (node) => ts.isExpressionStatement(node) && node.getText().includes(text),
    { ...ctx, describe: `assertion containing "${text}"` },
    root
  )
}

function rewriteVerificationLink(model, ctx) {
  const test = testCall(model, 'passes the generated token in the email verification URL', ctx)
  const target = expressionIn(model, test, "toContain('/ru/verify-email')", ctx)
  model.replaceNode(
    target,
    `// Single-locale mode: no locale segment at all — see localePathPrefix's
        // doc comment.
        expect(payload.verificationUrl).toContain('/verify-email')
        expect(payload.verificationUrl).not.toMatch(/\\/[a-z]{2}\\/verify-email/)`,
    { ...ctx, includeLeadingComments: true }
  )
}

function rewriteResetLink(model, ctx) {
  const test = testCall(model, 'should queue reset email for known user', ctx)
  const property = findUniqueNode(
    model,
    (node) => ts.isPropertyAssignment(node) && node.name.getText() === 'resetUrl',
    { ...ctx, describe: 'password-reset URL expectation' },
    test
  )
  model.replaceNode(
    property,
    `// Single-locale mode: no locale segment — asserting the bare path
          // still catches a stray prefix regressing back in.
          resetUrl: expect.stringMatching(/^https:\\/\\/[^/]+\\/reset-password\\?token=/)`,
    { ...ctx, includeLeadingComments: true }
  )
}

function rewriteResendLink(model, ctx) {
  const test = testCall(model, 'should queue verification email for unverified user', ctx)
  const property = findUniqueNode(
    model,
    (node) => ts.isPropertyAssignment(node) && node.name.getText() === 'verificationUrl',
    { ...ctx, describe: 'verification URL expectation' },
    test
  )
  model.replaceNode(
    property,
    'verificationUrl: expect.stringMatching(/^https:\\/\\/[^/]+\\/verify-email\\?token=/)',
    ctx
  )
}

function rewriteUnchangedLocaleComment(model, locale, ctx) {
  const test = testCall(
    model,
    'only includes fields whose value actually changed in the payload',
    ctx
  )
  const statement = expressionIn(model, test, 'mockResolvedValue', ctx)
  model.replaceNode(
    statement,
    `// \`locale\` is supplied but set to the same value the user already has (\`mockUser.locale\`
      // is '${locale}') — only \`name\` genuinely changed.
      ${statement.getText()}`,
    { ...ctx, includeLeadingComments: true }
  )
}

function authService(model, { locale }, ctx) {
  normalizeRussianFixtureLiterals(model, locale, ctx)
  rewriteExplicitLocaleTest(model, locale, ctx)
  rewriteFallbackLocaleTest(model, locale, ctx)
  rewriteAuthServiceSpecialCase(model, ctx)
  rewriteUnchangedLocaleComment(model, locale, ctx)
  rewriteVerificationLink(model, ctx)
  rewriteResetLink(model, ctx)
  rewriteResendLink(model, ctx)
}

export function registerLocaleAuthServiceOperation(registry) {
  registry.define('locale.auth-service-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:auth-service-test:locale', locale),
      claim('ts:auth-service-test:explicit-body-locale', locale),
      claim('ts:auth-service-test:fallback-locale', locale),
      absent('ts:auth-service-test:locale-prefixed-links'),
    ],
    adapter: authService,
  })
}
