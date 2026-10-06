import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { TEST_PASSWORD, uniqueEmail } from './helpers'
import { inviteRecipient, membershipCount } from './invitation-recipient.helpers'
import { resetInvitationRegistrationIpBudget } from './invitation-registration-budget.helpers'

test.beforeEach(() => resetInvitationRegistrationIpBudget())

for (const locale of SUPPORTED_LOCALES) {
  for (const loseResponse of [false, true]) {
    test(`recipient ${locale} (${loseResponse ? 'lost acceptance response' : 'acknowledged acceptance'}): registration, verification and consent`, async ({
      page,
      context,
    }) => {
      test.setTimeout(180000)
      const target = activeTarget()
      const catalogue = JSON.parse(
        readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
      )
      const t = catalogue.invitationRecipient
      const email = uniqueEmail('invited-registration')
      const { org, token } = await inviteRecipient(email)
      const errors: string[] = []
      page.on('response', async (response) => {
        // Capture only bounded status/code diagnostics; never URLs, cookies or request/response bodies.
        if (!new URL(response.url()).pathname.startsWith('/api/invitation-flows/')) return
        if (response.ok()) return
        const body = await response.json().catch(() => null)
        const errorCode =
          typeof body?.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(body.errorCode)
            ? body.errorCode
            : 'UNSTRUCTURED_ERROR'
        await test.info().attach('invitation-response-status', {
          body: JSON.stringify({ status: response.status(), errorCode }),
          contentType: 'application/json',
        })
      })
      page.on('pageerror', (error) => errors.push(error.name))
      await page.goto(
        localizedFrontendUrl(target.origins.product, locale, `invite/accept?token=${token}`)
      )
      await expect(page).toHaveURL(new RegExp(`/${locale}/invite/flow/[A-Za-z0-9_-]{22}$`))
      expect(page.url()).not.toContain(token)
      await expect(page.getByRole('heading', { name: t.signInTitle })).toBeVisible()
      expect(membershipCount(email, org.id)).toBe('0')
      const ownerCookie = (await context.cookies()).find(
        (cookie) =>
          cookie.name ===
          (target.origins.product.startsWith('https:')
            ? '__Host-amcore_invite_browser'
            : 'amcore_invite_browser_local')
      )
      expect(ownerCookie).toMatchObject({
        httpOnly: true,
        secure: target.origins.product.startsWith('https:'),
        sameSite: 'Lax',
        path: '/',
      })
      await expectNoAxeViolations(page)
      await page.getByRole('tab', { name: catalogue.auth.register, exact: true }).click()
      const registration = page.getByRole('tabpanel', {
        name: catalogue.auth.register,
        exact: true,
      })
      await expect(registration).toBeVisible()
      await expect(
        registration.getByRole('textbox', { name: catalogue.auth.email, exact: true })
      ).toHaveValue(email)
      await expect(
        registration.getByRole('textbox', { name: catalogue.auth.email, exact: true })
      ).toHaveAttribute('readonly', '')
      await registration.getByLabel(catalogue.auth.password, { exact: true }).fill(TEST_PASSWORD)
      await registration.getByRole('button', { name: catalogue.auth.register, exact: true }).click()
      await expect(page.getByRole('heading', { name: t.verifyTitle })).toBeVisible()
      expect(membershipCount(email, org.id)).toBe('0')
      // Own valid token fixture exercises the real verification API; no inbox arrival claim.
      const verificationToken = randomBytes(32).toString('hex')
      const verificationHash = createHash('sha256').update(verificationToken).digest('hex')
      expect(
        guardedSql(
          `UPDATE core.email_verification_tokens SET "tokenHash"=:'hash' WHERE "userId"=(SELECT id FROM core.users WHERE "emailCanonical"=:'email') AND used=false;`,
          { hash: verificationHash, email }
        )
      ).toContain('UPDATE 1')
      const verificationTab = await context.newPage()
      await verificationTab.goto(
        localizedFrontendUrl(
          target.origins.product,
          locale,
          `verify-email?token=${verificationToken}`
        )
      )
      await expect(
        verificationTab.getByText(catalogue.auth.verifyEmailSuccess, { exact: true })
      ).toBeVisible()
      expect(
        await verificationTab.getByRole('link', { name: t.returnToInvitation, exact: true }).count()
      ).toBe(0)
      expect(membershipCount(email, org.id)).toBe('0')
      await verificationTab.close()
      await page.bringToFront()
      await page.getByRole('button', { name: t.checkVerification, exact: true }).click()
      await expect(
        page.getByRole('heading', {
          name: t.consentTitle.replace('{organization}', org.name),
          exact: true,
        })
      ).toBeVisible()
      await expect(page.getByText('MEMBER', { exact: true })).toBeVisible()
      expect(membershipCount(email, org.id)).toBe('0')
      await expectNoAxeViolations(page)
      let acceptRequests = 0
      if (loseResponse)
        await page.route('**/api/invitation-flows/*/accept', async (route) => {
          acceptRequests++
          const response = await route.fetch()
          expect(response.status()).toBe(200)
          await route.abort('failed')
        })
      await page.getByRole('button', { name: t.accept, exact: true }).click()
      if (loseResponse) {
        await expect(page.getByText(t.unknownOutcome, { exact: true })).toBeVisible()
        expect(membershipCount(email, org.id)).toBe('1')
        await page.reload()
        await expect(page.getByRole('heading', { name: t.unusableTitle })).toBeVisible()
        await page.getByRole('button', { name: t.recover, exact: true }).click()
        await expect(page.getByRole('heading', { name: t.joinedTitle })).toBeVisible()
        expect(acceptRequests).toBe(1)
      } else {
        await expect(page.getByRole('heading', { name: t.joinedTitle })).toBeVisible()
        expect(membershipCount(email, org.id)).toBe('1')
        await page.reload()
        await expect(page.getByRole('heading', { name: t.unusableTitle })).toBeVisible()
      }
      expect(membershipCount(email, org.id)).toBe('1')
      expect(errors).toEqual([])
    })
  }
}
