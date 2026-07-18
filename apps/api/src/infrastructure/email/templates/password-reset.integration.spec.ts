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
  name: 'Александр',
  resetUrl: 'https://app.example.com/reset-password?token=raw-token-abc',
  expiresIn: '1 час',
}

describe('PasswordResetEmail Template (Integration)', () => {
  it('should render in Russian by default', async () => {
    const html = await render(PasswordResetEmail(baseProps))

    expect(html).toBeTruthy()
    expect(typeof html).toBe('string')

    expect(html).toContain('Александр')
    expect(html).toContain('Сброс пароля')
    expect(html).toContain('1 час')

    // The raw reset token must reach the recipient via the button href.
    expect(html).toContain('https://app.example.com/reset-password?token=raw-token-abc')

    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('</html>')
  })

  it('should render in English when locale=en', async () => {
    const html = await render(PasswordResetEmail({ ...baseProps, locale: 'en' }))

    expect(html).toContain('Password Reset')
    expect(html).toContain(baseProps.resetUrl)
  })

  it('should include the security warning about unrequested resets', async () => {
    const html = await render(PasswordResetEmail(baseProps))

    // The ⚠️-prefixed warning text block (passwordReset.ignoreInfo).
    expect(html).toContain('⚠️')
  })

  it('should have proper HTML structure for email clients', async () => {
    const html = await render(PasswordResetEmail(baseProps))

    expect(html).toMatch(/<table/i)
    expect(html).toMatch(/style="/i)
  })

  it('getPasswordResetSubject returns a localized, non-empty subject', () => {
    expect(getPasswordResetSubject('ru')).toBeTruthy()
    expect(getPasswordResetSubject('en')).toBeTruthy()
    expect(getPasswordResetSubject('ru')).not.toBe(getPasswordResetSubject('en'))
  })
})
