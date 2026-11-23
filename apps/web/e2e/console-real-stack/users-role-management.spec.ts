import { completeMfaStepUp } from '../shared/mfa-login'
import { isProductHome, messages, productPath } from '../shared/product-settings'
import { activeTarget } from '../support/managed-target.mjs'

const standTarget = activeTarget()
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'

import { loginViaUi, registerViaUi, TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'

import { ageSessionLastAuthAt, countLiveSessions, setSystemRole } from './helpers'

async function registerOnProduct(browser: Browser, email: string): Promise<void> {
  const product = await browser.newContext({
    baseURL: `${standTarget.origins.product}`,
    ignoreHTTPSErrors: true,
  })
  const page = await product.newPage()
  await registerViaUi(page, email)
  await expect(page).toHaveURL(
    (url) => url.origin === standTarget.origins.product && isProductHome(url)
  )
  await product.close()
}

async function signInToConsole(
  browser: Browser,
  email: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: `${standTarget.origins.console}`,
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()
  await loginViaUi(page, email, { mfa: 'required', surface: 'console' })
  await expect(page).toHaveURL(
    (url) => url.origin === standTarget.origins.console && isProductHome(url)
  )
  return { context, page }
}

async function openRoleMenu(page: Page, targetEmail: string) {
  const row = page.getByRole('row').filter({ hasText: targetEmail })
  await row.getByRole('button', { name: messages.console.usersColumnActions }).click()
}

test('host-mode: promoting with a fresh session needs no step-up and revokes the target session', async ({
  browser,
}) => {
  const adminEmail = uniqueEmail('console-users-promote')
  await registerOnProduct(browser, adminEmail)
  setSystemRole(adminEmail, 'SUPER_ADMIN')
  const admin = await signInToConsole(browser, adminEmail)

  const targetEmail = uniqueEmail('console-users-promote-target')
  await registerOnProduct(browser, targetEmail)

  const stepUpResponses: number[] = []
  admin.page.on('response', (response) => {
    if (response.url().endsWith('/api/auth/step-up')) stepUpResponses.push(response.status())
  })

  await admin.page.goto(productPath('/users'))
  await openRoleMenu(admin.page, targetEmail)
  await admin.page.getByRole('menuitem', { name: messages.console.usersActionPromote }).click()
  await admin.page
    .getByRole('alertdialog')
    .getByRole('button', { name: messages.console.usersActionPromote })
    .click()

  await expect(
    admin.page
      .getByRole('row')
      .filter({ hasText: targetEmail })
      .getByText(messages.console.superAdminRole)
  ).toBeVisible()
  expect(stepUpResponses).toHaveLength(0)
  expect(countLiveSessions(targetEmail)).toBe(0)

  await admin.context.close()
})

test('host-mode: demoting with an aged session requires step-up and never exposes a token', async ({
  browser,
}) => {
  const adminEmail = uniqueEmail('console-users-demote')
  await registerOnProduct(browser, adminEmail)
  setSystemRole(adminEmail, 'SUPER_ADMIN')
  const admin = await signInToConsole(browser, adminEmail)
  ageSessionLastAuthAt(adminEmail)

  const targetEmail = uniqueEmail('console-users-demote-target')
  await registerOnProduct(browser, targetEmail)
  setSystemRole(targetEmail, 'SUPER_ADMIN')

  const stepUpBodies: string[] = []
  admin.page.on('response', async (response) => {
    if (response.url().endsWith('/api/auth/step-up')) {
      stepUpBodies.push(await response.text().catch(() => ''))
    }
  })

  await admin.page.goto(productPath('/users'))
  await openRoleMenu(admin.page, targetEmail)
  await admin.page.getByRole('menuitem', { name: messages.console.usersActionDemote }).click()
  await admin.page
    .getByRole('alertdialog')
    .getByRole('button', { name: messages.console.usersActionDemote })
    .click()

  const stepUpDialog = admin.page.getByRole('dialog', { name: messages.console.stepUpTitle })
  await expect(stepUpDialog).toBeVisible()
  await stepUpDialog.getByLabel(messages.console.loginPassword, { exact: true }).fill(TEST_PASSWORD)
  await stepUpDialog.getByRole('button', { name: messages.console.stepUpSubmit }).click()
  await completeMfaStepUp(admin.page, adminEmail)

  await expect(stepUpDialog).toBeHidden()
  await expect(
    admin.page
      .getByRole('row')
      .filter({ hasText: targetEmail })
      .getByText(messages.console.usersColumnUser, { exact: true })
  ).toBeVisible()

  expect(stepUpBodies).toHaveLength(2)
  for (const body of stepUpBodies) {
    expect(body).not.toContain('accessToken')
    expect(body).not.toContain('refreshToken')
  }
  expect(await admin.page.content()).not.toContain('accessToken')
  expect(countLiveSessions(targetEmail)).toBe(0)

  await admin.context.close()
})

test('host-mode: self-row never offers a role action', async ({ browser }) => {
  const adminEmail = uniqueEmail('console-users-self')
  await registerOnProduct(browser, adminEmail)
  setSystemRole(adminEmail, 'SUPER_ADMIN')
  const admin = await signInToConsole(browser, adminEmail)

  await admin.page.goto(productPath('/users'))
  const ownRow = admin.page.getByRole('row').filter({ hasText: adminEmail })
  await expect(
    ownRow.getByRole('button', { name: messages.console.usersColumnActions })
  ).toHaveCount(0)

  await admin.context.close()
})
