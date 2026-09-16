import { EMAIL_TEST_BODIES } from './project-locale-email-test-bodies.mjs'
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

function subjectBody(template, locale) {
  if (template === 'invite') {
    return `it('should localize the subject with the org name', () => {\n    expect(getOrgInviteSubject('Acme Inc.', '${locale}')).toContain('Acme Inc.')\n  })`
  }
  const fn = template === 'verification' ? 'getEmailVerificationSubject' : 'getPasswordResetSubject'
  return `it('${fn} returns a non-empty subject', () => {\n    expect(${fn}('${locale}')).toBeTruthy()\n  })`
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
  model.replaceNode(
    testCall(model, titles[template].subject, ctx),
    subjectBody(template, locale),
    ctx
  )
  if (locale === 'en') return
  model.replaceNode(
    defaultTest(model, template, ctx),
    EMAIL_TEST_BODIES[template === 'invite' ? 'inviteSignIn' : template],
    ctx
  )
  if (template === 'invite') {
    model.replaceNode(
      testCall(model, 'should render the sign-up CTA when the recipient has no account', ctx),
      EMAIL_TEST_BODIES.inviteSignUp,
      ctx
    )
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
