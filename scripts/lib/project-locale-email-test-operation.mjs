import ts from 'typescript'

import { findAllNodes, findUniqueNode } from './path-algebra-ast-query.mjs'
import { absent, claim, testCall } from './project-locale-ast-helpers.mjs'

const TEMPLATES = ['verification', 'invite', 'reset']
const paramsSchema = (params) =>
  params !== null &&
  typeof params === 'object' &&
  Object.keys(params).length === 2 &&
  ['en', 'ru'].includes(params.locale) &&
  TEMPLATES.includes(params.template)

const titles = {
  verification: {
    locale: 'should render in Russian when locale=ru',
    subject: 'getEmailVerificationSubject returns a localized, non-empty subject',
  },
  invite: {
    locale: 'should render in Russian when locale=ru',
    subject: 'should localize the subject with the org name',
  },
  reset: {
    locale: 'should render in Russian when locale=ru',
    subject: 'getPasswordResetSubject returns a localized, non-empty subject',
  },
}

const RU_LITERALS = {
  verification: new Map([
    ['24 hours', '24 часа'],
    ['Verify your email', 'Подтвердите ваш email'],
    ['Verify Email', 'Подтвердить email'],
    ['Подтвердите ваш email', 'Verify your email'],
  ]),
  invite: new Map([['Sign in to accept the invitation', 'Войти и принять приглашение']]),
  reset: new Map([
    ['Password Reset', 'Сброс пароля'],
    ['60 minutes', '60 минут'],
  ]),
}

const INVITE_SIGNUP_LITERALS = new Map([
  ['Create an account to join', 'Создать аккаунт и присоединиться'],
  ['Sign in to accept the invitation', 'Войти и принять приглашение'],
])

function stringLiterals(model, root) {
  return findAllNodes(model, (node) => ts.isStringLiteral(node), root)
}

function rewriteLiterals(model, root, replacements, ctx) {
  const counts = new Map([...replacements].map(([before]) => [before, 0]))
  for (const node of stringLiterals(model, root)) {
    const after = replacements.get(node.text)
    if (after === undefined) continue
    counts.set(node.text, counts.get(node.text) + 1)
    model.replaceNode(node, `'${after}'`, ctx)
  }
  for (const [value, count] of counts) {
    if (count !== 1) throw new Error(`${ctx.operationKey}: expected one "${value}", found ${count}`)
  }
}

function rewriteSubjectTest(model, test, locale, ctx) {
  const assertions = findAllNodes(
    model,
    (node) => ts.isExpressionStatement(node) && node.getText().startsWith('expect('),
    test
  )
  if (assertions.length < 2) throw new Error(`${ctx.operationKey}: expected subject assertions`)
  const selected = assertions.find((node) => node.getText().includes(`'${locale}'`))
  if (!selected) throw new Error(`${ctx.operationKey}: selected subject assertion is missing`)
  for (const assertion of assertions) if (assertion !== selected) model.removeNode(assertion, ctx)
  const title = test.arguments[0]
  if (title.text.includes('localized, non-empty')) {
    model.replaceNode(title, `'${title.text.replace('localized, non-empty', 'non-empty')}'`, ctx)
  }
}

function rewriteInviteComment(model, test, ctx) {
  const assertion = findUniqueNode(
    model,
    (node) => ts.isExpressionStatement(node) && node.getText().includes("toContain('Acme Inc.')"),
    { ...ctx, describe: 'invite localized-content assertion' },
    test
  )
  model.replaceNode(
    assertion,
    `// Localized content and interpolated props.\n    ${assertion.getText()}`,
    {
      ...ctx,
      includeLeadingComments: true,
    }
  )
}

function defaultTest(model, template, ctx) {
  return testCall(
    model,
    `should render in the base locale (English) by default${
      template === 'invite' ? ' with the sign-in CTA' : ''
    }`,
    ctx
  )
}

function applyEmailTest(model, { locale, template }, ctx) {
  model.removeNode(testCall(model, titles[template].locale, ctx), ctx)
  rewriteSubjectTest(model, testCall(model, titles[template].subject, ctx), locale, ctx)
  if (locale === 'en') return
  const defaultLocale = defaultTest(model, template, ctx)
  model.replaceNode(
    defaultLocale.arguments[0],
    `'${defaultLocale.arguments[0].text.replace('base locale (English)', 'base (and only) supported locale')}'`,
    ctx
  )
  if (template === 'invite') rewriteInviteComment(model, defaultLocale, ctx)
  rewriteLiterals(model, defaultLocale, RU_LITERALS[template], ctx)
  if (template === 'invite') {
    const signup = testCall(
      model,
      'should render the sign-up CTA when the recipient has no account',
      ctx
    )
    rewriteLiterals(model, signup, INVITE_SIGNUP_LITERALS, ctx)
  }
}

export function registerLocaleEmailTestOperation(registry) {
  registry.define('locale.email-template-test', {
    paramsSchema,
    deriveSemanticWrites: ({ locale, template }) => [
      absent(`ts:email-test:${template}:secondary-locale`),
      claim(`ts:email-test:${template}:default-locale`, locale),
      claim(`ts:email-test:${template}:subject-locale`, locale),
    ],
    adapter: applyEmailTest,
  })
}
