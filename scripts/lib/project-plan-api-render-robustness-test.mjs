// init:project --mode=single: render-robustness.integration.spec.ts. Found
// via the real `pnpm --filter api test` in init-project.test.mjs: this
// fixture runs every email template through BOTH locales via
// `it.each<Locale>(['ru', 'en'])`, which no longer typechecks once `Locale`
// (apps/api/src/infrastructure/email/messages.ts's alias for
// SupportedLocale) narrows to one value. Whole-file exactContentStep, not a
// patch: the locale-keyed `expect` map on every case, the `it.each` calls,
// and `localeIds`'s hardcoded `.ru` lookup all need to collapse to the one
// kept locale together. The "before" half lives in
// project-plan-api-render-robustness-before.mjs to stay under the repo's
// ~150-line-per-file guidance.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'
import { RENDER_ROBUSTNESS_BEFORE } from './project-plan-api-render-robustness-before.mjs'

const WELCOME_WORD = { en: 'Welcome', ru: 'Добро пожаловать' }

function after(locale) {
  const other = locale === 'en' ? 'ru' : 'en'
  return `/**
 * i18n / render-robustness integration tests (EQS-08).
 *
 * Real React Email rendering (no mocks), Vitest + happy-dom. Covers the welcome,
 * secret-bearing (reset/verification/invite) templates in the one supported
 * locale and asserts:
 *  - non-empty HTML with the expected localized content,
 *  - NO raw message-id leakage (a missing key would render its literal id),
 *  - a non-empty plaintext alternative (\`render(node, { plainText: true })\`)
 *    that contains the localized words and no HTML tags,
 *  - locale fallback to the one supported locale when \`locale\` is omitted.
 *
 * @see https://react.email/docs/introduction#testing
 */

import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'

import { emailMessages, type Locale } from '../messages'

import { EmailVerificationEmail } from './email-verification'
import { OrgInviteEmail } from './org-invite'
import { PasswordResetEmail } from './password-reset'
import { WelcomeEmail } from './welcome'

type RenderCase = {
  name: string
  namespace: string
  build: (locale?: Locale) => Parameters<typeof render>[0]
  expectedWord: string
}

const cases: RenderCase[] = [
  {
    name: 'welcome',
    namespace: 'welcome',
    build: (locale) => WelcomeEmail({ name: 'Иван', email: 'ivan@example.com', locale }),
    expectedWord: '${WELCOME_WORD[locale]}',
  },
  {
    name: 'password-reset',
    namespace: 'passwordReset',
    build: (locale) =>
      PasswordResetEmail({
        name: 'Иван',
        resetUrl: 'https://app.example.com/reset-password?token=abc',
        expiresInMinutes: 15,
        locale,
      }),
    expectedWord: '${locale === 'en' ? 'Password Reset' : 'Сброс пароля'}',
  },
  {
    name: 'email-verification',
    namespace: 'emailVerification',
    build: (locale) =>
      EmailVerificationEmail({
        name: 'Иван',
        verificationUrl: 'https://app.example.com/verify-email?token=xyz',
        expiresInHours: 48,
        locale,
      }),
    expectedWord: '${locale === 'en' ? 'Verify' : 'Подтвердите'}',
  },
  {
    name: 'org-invite',
    namespace: 'orgInvite',
    build: (locale) =>
      OrgInviteEmail({
        orgName: 'Acme',
        inviterName: 'Alex',
        inviterEmail: 'alex@example.com',
        roleName: 'MEMBER',
        hasAccount: true,
        acceptUrl: 'https://app.example.com/invite/accept?token=abc',
        expiresInDays: 7,
        locale,
      }),
    expectedWord: '${locale === 'en' ? 'invited' : 'пригласил'}',
  },
]

const localeIds = (namespace: string): string[] =>
  Object.keys(emailMessages.${locale}).filter((id) => id.startsWith(\`\${namespace}.\`))

describe('email templates — render robustness (EQS-08)', () => {
  describe.each(cases)('$name', ({ namespace, build, expectedWord }) => {
    it('renders translated HTML with no message-id leak', async () => {
      const html = await render(build('${locale}'))

      expect(html).toBeTruthy()
      expect(html).toContain(expectedWord)
      // A missing translation would render the literal id (e.g. "welcome.title").
      for (const id of localeIds(namespace)) {
        expect(html, \`unresolved message id "\${id}" leaked into HTML\`).not.toContain(id)
      }
    })

    it('produces a non-empty plaintext alternative', async () => {
      const text = await render(build('${locale}'), { plainText: true })
      // html-to-text uppercases headings, so compare case-insensitively.
      const lower = text.toLowerCase()

      expect(text).toBeTruthy()
      expect(text.length).toBeGreaterThan(0)
      expect(lower).toContain(expectedWord.toLowerCase())
      // Plaintext must not carry HTML tags.
      expect(text).not.toMatch(/<[a-z!/][^>]*>/i)
      // ...and still not leak message ids (ids are lowercase).
      for (const id of localeIds(namespace)) {
        expect(lower).not.toContain(id.toLowerCase())
      }
    })
  })

  it('falls back to the one supported locale when locale is omitted', async () => {
    const html = await render(WelcomeEmail({ name: 'Ivan', email: 'ivan@example.com' }))

    expect(html).toContain('${WELCOME_WORD[locale]}')
    expect(html).not.toContain('${WELCOME_WORD[other]}')
  })
})
`
}

export function buildApiRenderRobustnessTestSteps(root, locale) {
  return [
    exactContentStep(
      path.join(
        root,
        'apps/api/src/infrastructure/email/templates/render-robustness.integration.spec.ts'
      ),
      { expectedBefore: RENDER_ROBUSTNESS_BEFORE, after: after(locale) },
      'render-robustness.integration.spec.ts: test only the kept locale'
    ),
  ]
}
