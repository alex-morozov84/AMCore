import { type Browser, expect } from '@playwright/test'

import type messages from '../../messages/en.json'
import { guardedSql } from '../support/managed-target.mjs'
import { SETUP_PASSWORD } from '../support/organization-setup'

import { openProvisioningMail } from './mailbox'

type Messages = typeof messages
/** Verify actual rendered mail in a separate recipient browser; never fabricate mailbox proof. */
export async function acceptAdministrator(
  browser: Browser,
  email: string,
  organization: string,
  messages: Messages,
  origin?: string
): Promise<string> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' })
  try {
    const page = await context.newPage()
    await openProvisioningMail(page, email, 'invite/accept', origin)
    const consent = messages.invitationRecipient
    await expect(page.getByRole('heading', { name: consent.signInTitle })).toBeVisible()
    await page.getByRole('tab', { name: messages.auth.register, exact: true }).click()
    const registration = page.getByRole('tabpanel', { name: messages.auth.register, exact: true })
    await registration.getByLabel(messages.auth.password, { exact: true }).fill(SETUP_PASSWORD)
    await registration.getByRole('button', { name: messages.auth.register, exact: true }).click()
    await expect(page.getByRole('heading', { name: consent.verifyTitle })).toBeVisible()
    const userId = guardedSql('SELECT id FROM core.users WHERE "emailCanonical"=:\'email\';', {
      email,
    }).trim()
    expect(
      guardedSql('SELECT count(*) FROM core.org_members WHERE "userId"=:\'id\';', {
        id: userId,
      }).trim()
    ).toBe('0')
    const verification = await context.newPage()
    await openProvisioningMail(verification, email, 'verify-email', origin)
    await expect(
      verification.getByText(messages.auth.verifyEmailSuccess, { exact: true })
    ).toBeVisible()
    expect(
      guardedSql('SELECT count(*) FROM core.org_members WHERE "userId"=:\'id\';', {
        id: userId,
      }).trim()
    ).toBe('0')
    await page.getByRole('button', { name: consent.checkVerification, exact: true }).click()
    await expect(
      page.getByRole('heading', {
        name: consent.consentTitle.replace('{organization}', organization),
        exact: true,
      })
    ).toBeVisible()
    await page.getByRole('button', { name: consent.accept, exact: true }).click()
    await expect(page.getByRole('heading', { name: consent.joinedTitle })).toBeVisible()
    return userId
  } finally {
    await context.close()
  }
}
