import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { TEST_PASSWORD, uniqueEmail } from './helpers'
import { inviteRecipient, membershipCount } from './invitation-recipient.helpers'
import { resetInvitationRegistrationIpBudget } from './invitation-registration-budget.helpers'

test.beforeEach(() => resetInvitationRegistrationIpBudget())

for (const locale of SUPPORTED_LOCALES)
  test(`recipient ${locale}: real verification API, explicit return and reset/reopen`, async ({
    page,
    context,
  }) => {
    const target = activeTarget()
    const c = JSON.parse(
      readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
    )
    const t = c.invitationRecipient
    const email = uniqueEmail('selector-reset')
    const { org, token } = await inviteRecipient(email)
    const original = localizedFrontendUrl(
      target.origins.product,
      locale,
      `invite/accept?token=${token}`
    )
    await page.goto(original)
    await page.getByRole('tab', { name: c.auth.register, exact: true }).click()
    await page
      .getByRole('tabpanel', { name: c.auth.register, exact: true })
      .getByLabel(c.auth.password, { exact: true })
      .fill(TEST_PASSWORD)
    await page
      .getByRole('tabpanel', { name: c.auth.register, exact: true })
      .getByRole('button', { name: c.auth.register, exact: true })
      .click()
    await expect(page.getByRole('heading', { name: t.verifyTitle, exact: true })).toBeVisible()
    const flowId = new URL(page.url()).pathname.split('/').at(-1)
    expect(flowId).toBeTruthy()
    const inspected = await context.request.get(
      new URL(`/api/invitation-flows/${flowId}/context`, target.origins.product).href
    )
    expect(inspected.ok()).toBe(true)
    const { binding } = await inspected.json()
    await page.getByRole('button', { name: t.verificationHelpAction, exact: true }).click()
    await expect(page).toHaveURL(/verify-email\?inviteReturn=/)
    const explicit = page.url()
    const selectorId = new URL(explicit).searchParams.get('inviteReturn')
    const verificationToken = randomBytes(32).toString('hex')
    expect(
      guardedSql(
        `UPDATE core.email_verification_tokens SET "tokenHash"=:'hash' WHERE "userId"=(SELECT id FROM core.users WHERE "emailCanonical"=:'email') AND used=false;`,
        { hash: createHash('sha256').update(verificationToken).digest('hex'), email }
      )
    ).toContain('UPDATE 1')
    await page.goto(`${explicit}&token=${verificationToken}`)
    await expect(page.getByText(c.auth.verifyEmailSuccess, { exact: true })).toBeVisible()
    await page.getByRole('link', { name: t.returnToInvitation, exact: true }).click()
    await expect(
      page.getByRole('heading', {
        name: t.consentTitle.replace('{organization}', org.name),
        exact: true,
      })
    ).toBeVisible()
    expect(membershipCount(email, org.id)).toBe('0')
    // Password reset uses a real generated token row for this account and revokes its sessions.
    expect(
      (
        await context.request.post(
          new URL('/api/auth/forgot-password', target.origins.product).href,
          { headers: { origin: target.origins.product }, data: { email } }
        )
      ).ok()
    ).toBe(true)
    const resetToken = randomBytes(32).toString('hex')
    expect(
      guardedSql(
        `UPDATE core.password_reset_tokens SET "tokenHash"=:'hash' WHERE "userId"=(SELECT id FROM core.users WHERE "emailCanonical"=:'email') AND used=false;`,
        { hash: createHash('sha256').update(resetToken).digest('hex'), email }
      )
    ).toContain('UPDATE 1')
    const password = 'New!AMCore2026'
    await page.goto(
      localizedFrontendUrl(target.origins.product, locale, `reset-password?token=${resetToken}`)
    )
    await page.getByLabel(c.auth.newPassword, { exact: true }).fill(password)
    const reset = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/reset-password'
    )
    await page.getByRole('button', { name: c.auth.resetPasswordSubmit, exact: true }).click()
    expect((await reset).ok()).toBe(true)
    expect(
      guardedSql(
        `SELECT count(*) FROM core.sessions WHERE "userId"=(SELECT id FROM core.users WHERE "emailCanonical"=:'email');`,
        { email }
      ).trim()
    ).toBe('0')
    expect(membershipCount(email, org.id)).toBe('0')
    await context.request.post(new URL('/api/auth/logout', target.origins.product).href, {
      headers: { origin: target.origins.product },
    })
    await page.goto(original)
    await expect(page.getByRole('heading', { name: t.signInTitle, exact: true })).toBeVisible()
    await page
      .getByRole('tabpanel', { name: c.auth.login, exact: true })
      .getByLabel(c.auth.password, { exact: true })
      .fill(password)
    await page
      .getByRole('tabpanel', { name: c.auth.login, exact: true })
      .getByRole('button', { name: c.auth.login, exact: true })
      .click()
    await expect(
      page.getByRole('heading', {
        name: t.consentTitle.replace('{organization}', org.name),
        exact: true,
      })
    ).toBeVisible()
    expect(membershipCount(email, org.id)).toBe('0')
    // Consumed selector never gets navigation authority after a replacement authentication.
    const stale = await context.request.post(
      new URL(`/api/invitation-verification-return/${selectorId}`, target.origins.product).href,
      {
        headers: { origin: target.origins.product },
        data: { expectedSessionBinding: binding.sessionBinding },
      }
    )
    expect(stale.status()).toBe(409)
    expect((await stale.json()).errorCode).toBe('INVITE_FLOW_CHANGED')
  })
