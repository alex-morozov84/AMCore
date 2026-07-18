/**
 * Integration test for Email Verification Email Template
 *
 * Tests real React Email rendering without mocks.
 * Uses Vitest (React Email's official testing framework) with happy-dom.
 *
 * @see https://react.email/docs/introduction#testing
 */

import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'

import EmailVerificationEmail, { getEmailVerificationSubject } from './email-verification'

const baseProps = {
  name: 'Александр',
  verificationUrl: 'https://app.example.com/verify-email?token=raw-token-xyz',
  expiresIn: '24 часа',
}

describe('EmailVerificationEmail Template (Integration)', () => {
  it('should render in Russian by default', async () => {
    const html = await render(EmailVerificationEmail(baseProps))

    expect(html).toBeTruthy()
    expect(typeof html).toBe('string')

    expect(html).toContain('Александр')
    expect(html).toContain('24 часа')

    // The raw verification token must reach the recipient via the button href.
    expect(html).toContain('https://app.example.com/verify-email?token=raw-token-xyz')

    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('</html>')
  })

  it('should render in English when locale=en', async () => {
    const html = await render(EmailVerificationEmail({ ...baseProps, locale: 'en' }))

    expect(html).toContain('Verify')
    expect(html).toContain(baseProps.verificationUrl)
  })

  it('should have proper HTML structure for email clients', async () => {
    const html = await render(EmailVerificationEmail(baseProps))

    expect(html).toMatch(/<table/i)
    expect(html).toMatch(/style="/i)
  })

  it('getEmailVerificationSubject returns a localized, non-empty subject', () => {
    expect(getEmailVerificationSubject('ru')).toBeTruthy()
    expect(getEmailVerificationSubject('en')).toBeTruthy()
    expect(getEmailVerificationSubject('ru')).not.toBe(getEmailVerificationSubject('en'))
  })
})
