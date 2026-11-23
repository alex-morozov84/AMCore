import { type Browser, expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations, waitForAnimationsToFinish } from '../../shared/axe'
import { requirePathConsole } from '../../shared/console-applicability'
import { completeMfaStepUp } from '../../shared/mfa-login'
import {
  consolePath,
  isProductHome,
  messages,
  productPath,
  translate,
} from '../../shared/product-settings'
import { waitForIdleRegions } from '../../shared/visual-stability'
import { ageSessionLastAuthAt, countLiveSessions, setSystemRole } from '../admin-helpers'
import { loginViaUi, registerViaUi, TEST_PASSWORD, uniqueEmail } from '../helpers'
import { waitForSessionTransitions } from '../sessions-readability'

requirePathConsole()

async function signInAsPathAdmin(page: Page, email: string, create = true) {
  // Register once; later calls sign in to the existing admin account.
  // Clear the target user's session before opening the admin login form.
  await page.context().clearCookies()
  if (create) await registerViaUi(page, email, { name: 'Sessions Panel Admin' })
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(isProductHome)
}

/** A second real login (distinct user agent) so the target has >1 active session to work with. */
async function addExtraSession(browser: Browser, email: string, userAgent: string): Promise<void> {
  const context = await browser.newContext({ userAgent })
  const page = await context.newPage()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(isProductHome)
  await context.close()
}

async function openTargetDetail(page: Page, targetEmail: string, count: number) {
  await page.goto(consolePath('/users'))
  await page.getByRole('link', { name: targetEmail }).click()
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: translate('console.userSessionsHeading', { count }),
      exact: true,
    })
  ).toBeVisible()
}

test('path-mode: session list shows a parsed device label, never the raw user agent, and total, not page length', async ({
  page,
  browser,
}) => {
  const adminEmail = uniqueEmail('sessions-list-admin')
  await signInAsPathAdmin(page, adminEmail)

  const targetEmail = uniqueEmail('sessions-list-target')
  // An authenticated visitor is redirected away from /register — start the
  // target's own registration from a logged-out context.
  await page.context().clearCookies()
  await registerViaUi(page, targetEmail)
  await page.context().clearCookies()
  await addExtraSession(
    browser,
    targetEmail,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  )
  await signInAsPathAdmin(page, adminEmail, false)

  await openTargetDetail(page, targetEmail, 2)

  const labels = page.getByRole('table').getByText('Chrome on Windows', { exact: true })
  await expect(labels).toHaveCount(2)
  await expect(labels.nth(0)).toBeVisible()
  await expect(labels.nth(1)).toBeVisible()
  expect(await page.content()).not.toMatch(/Mozilla\/5\.0/)
  await expect(page.getByText(translate('console.userSessionsHeading', { count: 2 }))).toBeVisible()
})

test('path-mode: revoking one session soft-revokes it and removes it from the list', async ({
  page,
  browser,
}) => {
  const adminEmail = uniqueEmail('sessions-revoke-one-admin')
  await signInAsPathAdmin(page, adminEmail)

  const targetEmail = uniqueEmail('sessions-revoke-one-target')
  await page.context().clearCookies()
  await registerViaUi(page, targetEmail)
  await page.context().clearCookies()
  await addExtraSession(
    browser,
    targetEmail,
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'
  )
  await signInAsPathAdmin(page, adminEmail, false)

  expect(countLiveSessions(targetEmail)).toBe(2)
  await openTargetDetail(page, targetEmail, 2)

  const row = page.getByRole('row').filter({ hasText: /iOS/i })
  const actionName = translate('console.userSessionsActionsFor', { device: '__device__' })
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace('__device__', '.+')
  await row.getByRole('button', { name: new RegExp('^' + actionName + '$') }).click()
  await page.getByRole('menuitem', { name: messages.console.userSessionsRevokeOne }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: messages.console.userSessionsRevokeOne })
    .click()

  await expect(row).toBeHidden()
  expect(countLiveSessions(targetEmail)).toBe(1)
})

test('path-mode: revoking all sessions requires confirmation and empties the list', async ({
  page,
  browser,
}) => {
  const adminEmail = uniqueEmail('sessions-revoke-all-admin')
  await signInAsPathAdmin(page, adminEmail)

  const targetEmail = uniqueEmail('sessions-revoke-all-target')
  await page.context().clearCookies()
  await registerViaUi(page, targetEmail)
  await page.context().clearCookies()
  await addExtraSession(
    browser,
    targetEmail,
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'
  )
  await signInAsPathAdmin(page, adminEmail, false)

  expect(countLiveSessions(targetEmail)).toBe(2)
  await openTargetDetail(page, targetEmail, 2)

  await page.getByRole('button', { name: messages.console.userSessionsRevokeAll }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: messages.console.userSessionsRevokeAll })
    .click()

  await expect(page.getByText(messages.console.userSessionsEmpty)).toBeVisible()
  expect(countLiveSessions(targetEmail)).toBe(0)
})

test('path-mode: revoking with an aged admin session requires step-up', async ({ page }) => {
  const adminEmail = uniqueEmail('sessions-stepup-admin')
  await signInAsPathAdmin(page, adminEmail)

  const targetEmail = uniqueEmail('sessions-stepup-target')
  await page.context().clearCookies()
  await registerViaUi(page, targetEmail)
  await page.context().clearCookies()
  await signInAsPathAdmin(page, adminEmail, false)

  ageSessionLastAuthAt(adminEmail)
  await openTargetDetail(page, targetEmail, 1)
  await page.getByRole('button', { name: messages.console.userSessionsRevokeAll }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: messages.console.userSessionsRevokeAll })
    .click()

  const stepUpDialog = page.getByRole('dialog', { name: messages.console.stepUpTitle })
  await expect(stepUpDialog).toBeVisible()
  await stepUpDialog.getByLabel(messages.console.loginPassword, { exact: true }).fill(TEST_PASSWORD)
  await stepUpDialog.getByRole('button', { name: messages.console.stepUpSubmit }).click()
  await completeMfaStepUp(page, adminEmail)

  await expect(stepUpDialog).toBeHidden()
  expect(countLiveSessions(targetEmail)).toBe(0)
})

test('path-mode: an operator viewing their own detail page sees no destructive session controls', async ({
  page,
}) => {
  const adminEmail = uniqueEmail('sessions-self-admin')
  await signInAsPathAdmin(page, adminEmail)

  await page.goto(consolePath('/users'))
  // The row's link is named after the account's display name ("Sessions
  // Panel Admin", shared by every admin this spec creates), not its email —
  // match the row by its email text instead, same as the revoke-one test's
  // `.filter({ hasText })` pattern.
  await page.getByRole('row').filter({ hasText: adminEmail }).getByRole('link').click()

  await expect(
    page.getByRole('button', { name: messages.console.userSessionsRevokeAll })
  ).toHaveCount(0)
  const label = messages.console.userSessionsSelfNote.match(/<link>(.*?)<\/link>/)?.[1]
  expect(label).toBeTruthy()
  await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute(
    'href',
    productPath('/settings/sessions')
  )
})

test('the Sessions card has no axe violations, populated or empty', async ({ page, browser }) => {
  const adminEmail = uniqueEmail('sessions-axe-admin')
  await signInAsPathAdmin(page, adminEmail)

  const targetEmail = uniqueEmail('sessions-axe-target')
  await page.context().clearCookies()
  await registerViaUi(page, targetEmail)
  await page.context().clearCookies()
  await addExtraSession(
    browser,
    targetEmail,
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'
  )
  await signInAsPathAdmin(page, adminEmail, false)

  await openTargetDetail(page, targetEmail, 2)
  await expect(
    page.getByRole('heading', { name: translate('console.userSessionsHeading', { count: 2 }) })
  ).toBeVisible()
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2)
  await waitForIdleRegions(page)
  await expect(
    page.getByRole('button', { name: messages.console.userSessionsRevokeAll })
  ).toBeEnabled()
  await waitForSessionTransitions(
    page.locator('[data-slot="card"]').filter({
      has: page.getByRole('heading', {
        name: translate('console.userSessionsHeading', { count: 2 }),
      }),
    })
  )
  await expectNoAxeViolations(page)

  await page.getByRole('button', { name: messages.console.userSessionsRevokeAll }).click()
  await waitForAnimationsToFinish(page, '[data-slot="alert-dialog-content"]')
  await waitForSessionTransitions(page.getByRole('alertdialog'))
  await expectNoAxeViolations(page)
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: messages.console.userSessionsRevokeAll })
    .click()
  await expect(page.getByText(messages.console.userSessionsEmpty)).toBeVisible()
  await expect(page.getByRole('alertdialog', { includeHidden: true })).toHaveCount(0)
  await waitForSessionTransitions(
    page.getByRole('button', { name: messages.console.userSessionsRevokeAll })
  )
  await expectNoAxeViolations(page)
})
