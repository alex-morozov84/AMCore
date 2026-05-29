/**
 * Integration test for Organization Invite Email Template (OB-02).
 *
 * Tests real React Email rendering without mocks.
 * Uses Vitest (React Email's official testing framework) with happy-dom.
 *
 * @see https://react.email/docs/introduction#testing
 */

import { render } from '@react-email/render'
import { describe, expect, it } from 'vitest'

import OrgInviteEmail, { getOrgInviteSubject } from './org-invite'

const baseProps = {
  orgName: 'Acme Inc.',
  inviterName: 'Александр Морозов',
  inviterEmail: 'alex@example.com',
  roleName: 'MEMBER',
  acceptUrl: 'https://app.example.com/invite/accept?token=raw-token-123',
  expiresIn: '7 дней',
}

describe('OrgInviteEmail Template (Integration)', () => {
  it('should render in Russian by default with the sign-in CTA', async () => {
    const html = await render(OrgInviteEmail({ ...baseProps, hasAccount: true }))

    expect(html).toBeTruthy()
    expect(typeof html).toBe('string')

    // Russian content
    expect(html).toContain('Acme Inc.')
    expect(html).toContain('Александр Морозов')
    expect(html).toContain('alex@example.com')
    expect(html).toContain('MEMBER')
    expect(html).toContain('Войти и принять приглашение')

    // The raw accept token must reach the recipient via the button href.
    expect(html).toContain('https://app.example.com/invite/accept?token=raw-token-123')

    // HTML structure
    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('</html>')
  })

  it('should render the sign-up CTA when the recipient has no account', async () => {
    const html = await render(OrgInviteEmail({ ...baseProps, hasAccount: false }))

    expect(html).toContain('Создать аккаунт и присоединиться')
    expect(html).not.toContain('Войти и принять приглашение')
  })

  it('should render in English', async () => {
    const html = await render(OrgInviteEmail({ ...baseProps, hasAccount: true, locale: 'en' }))

    expect(html).toContain('You have been invited to Acme Inc.')
    expect(html).toContain('Sign in to accept the invitation')
    expect(html).toContain('https://app.example.com/invite/accept?token=raw-token-123')
  })

  it('should localize the subject with the org name', () => {
    expect(getOrgInviteSubject('Acme Inc.', 'ru')).toContain('Acme Inc.')
    expect(getOrgInviteSubject('Acme Inc.', 'en')).toBe('Invitation to join Acme Inc.')
  })
})
