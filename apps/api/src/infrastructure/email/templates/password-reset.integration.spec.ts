/**
 * Integration test for Password Reset Email Template
 *
 * Tests real React Email rendering without mocks.
 * Uses Vitest (React Email's official testing framework) with happy-dom.
 *
 * @see https://react.email/docs/introduction#testing
 */

import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'

import PasswordResetEmail, { getPasswordResetSubject } from './password-reset'

const baseProps = {
  name: 'Alexander',
  resetUrl: 'https://app.example.com/reset-password?token=raw-token-abc',
  expiresInMinutes: 60,
}

// Supplied by the configured happy-dom test environment.
declare const DOMParser: typeof import('happy-dom').DOMParser

describe('PasswordResetEmail Template (Integration)', () => {
  it('should render in the base locale (English) by default', async () => {
    const html = await render(PasswordResetEmail(baseProps))

    expect(html).toMatch(/<table/i)
    expect(html).toMatch(/style="/i)

    expect(html).toContain('Alexander')
    expect(html).toContain('Password Reset')
    expect(html).toContain('60 minutes')

    // The raw reset token must reach the recipient via the button href.
    const document = new DOMParser().parseFromString(html, 'text/html')
    const cta = Array.from(document.querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Reset Password')
    )
    expect(cta?.getAttribute('href')).toBe(baseProps.resetUrl)

    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('</html>')
  })

  it('should render in Russian when locale=ru', async () => {
    const html = await render(PasswordResetEmail({ ...baseProps, locale: 'ru' }))

    expect(html).toContain('Сброс пароля')
    expect(html).toContain(baseProps.resetUrl)
  })

  it.each([
    ['en', 'If you did not request a password reset, please ignore this email.'],
    ['ru', 'Если вы не запрашивали сброс пароля, проигнорируйте это письмо.'],
  ] as const)('renders the unrequested-reset warning in %s', async (locale, warning) => {
    const html = await render(PasswordResetEmail({ ...baseProps, locale }))
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.body.textContent).toContain(warning)
  })

  it('getPasswordResetSubject returns a localized, non-empty subject', () => {
    expect(getPasswordResetSubject('ru')).toBeTruthy()
    expect(getPasswordResetSubject('en')).toBeTruthy()
    expect(getPasswordResetSubject('ru')).not.toBe(getPasswordResetSubject('en'))
  })
})
