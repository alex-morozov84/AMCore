/**
 * i18n / render-robustness integration tests (EQS-08).
 *
 * Real React Email rendering (no mocks), Vitest + happy-dom. Covers the welcome,
 * secret-bearing (reset/verification/invite) templates in both locales and asserts:
 *  - non-empty HTML with the expected localized content,
 *  - NO raw message-id leakage (a missing key would render its literal id),
 *  - a non-empty plaintext alternative (`render(node, { plainText: true })`)
 *    that contains the localized words and no HTML tags,
 *  - locale fallback to Russian when `locale` is omitted.
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
  expect: { ru: string; en: string }
}

const cases: RenderCase[] = [
  {
    name: 'welcome',
    namespace: 'welcome',
    build: (locale) => WelcomeEmail({ name: 'Иван', email: 'ivan@example.com', locale }),
    expect: { ru: 'Добро пожаловать', en: 'Welcome' },
  },
  {
    name: 'password-reset',
    namespace: 'passwordReset',
    build: (locale) =>
      PasswordResetEmail({
        name: 'Иван',
        resetUrl: 'https://app.example.com/reset-password?token=abc',
        expiresIn: '15 минут',
        locale,
      }),
    expect: { ru: 'Сброс пароля', en: 'Password Reset' },
  },
  {
    name: 'email-verification',
    namespace: 'emailVerification',
    build: (locale) =>
      EmailVerificationEmail({
        name: 'Иван',
        verificationUrl: 'https://app.example.com/verify-email?token=xyz',
        expiresIn: '48 часов',
        locale,
      }),
    expect: { ru: 'Подтвердите', en: 'Verify' },
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
        expiresIn: '7 дней',
        locale,
      }),
    expect: { ru: 'пригласил', en: 'invited' },
  },
]

const localeIds = (namespace: string): string[] =>
  Object.keys(emailMessages.ru).filter((id) => id.startsWith(`${namespace}.`))

describe('email templates — render robustness (EQS-08)', () => {
  describe.each(cases)('$name', ({ namespace, build, expect: expectedWord }) => {
    it.each<Locale>(['ru', 'en'])(
      'renders translated HTML with no message-id leak (%s)',
      async (locale) => {
        const html = await render(build(locale))

        expect(html).toBeTruthy()
        expect(html).toContain(expectedWord[locale])
        // A missing translation would render the literal id (e.g. "welcome.title").
        for (const id of localeIds(namespace)) {
          expect(html, `unresolved message id "${id}" leaked into HTML`).not.toContain(id)
        }
      }
    )

    it.each<Locale>(['ru', 'en'])(
      'produces a non-empty plaintext alternative (%s)',
      async (locale) => {
        const text = await render(build(locale), { plainText: true })
        // html-to-text uppercases headings, so compare case-insensitively.
        const lower = text.toLowerCase()

        expect(text).toBeTruthy()
        expect(text.length).toBeGreaterThan(0)
        expect(lower).toContain(expectedWord[locale].toLowerCase())
        // Plaintext must not carry HTML tags.
        expect(text).not.toMatch(/<[a-z!/][^>]*>/i)
        // ...and still not leak message ids (ids are lowercase).
        for (const id of localeIds(namespace)) {
          expect(lower).not.toContain(id.toLowerCase())
        }
      }
    )
  })

  it('falls back to Russian when locale is omitted', async () => {
    const html = await render(WelcomeEmail({ name: 'Иван', email: 'ivan@example.com' }))

    expect(html).toContain('Добро пожаловать')
    expect(html).not.toContain('Welcome,')
  })
})
