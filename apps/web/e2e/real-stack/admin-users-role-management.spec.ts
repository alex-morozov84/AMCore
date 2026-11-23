import { expect, type Page, test } from '@playwright/test'

import { requirePathConsole } from '../shared/console-applicability'
import { completeMfaStepUp } from '../shared/mfa-login'
import { consolePath, isProductHome, messages } from '../shared/product-settings'

import { ageSessionLastAuthAt, countLiveSessions, setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, TEST_PASSWORD, uniqueEmail } from './helpers'

requirePathConsole()

async function signInAsPathAdmin(page: Page, email: string) {
  await registerViaUi(page, email, { name: 'Role Management Admin' })
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(isProductHome)
}

async function openRoleMenu(page: Page, targetEmail: string) {
  const row = page.getByRole('row').filter({ hasText: targetEmail })
  await row.getByRole('button', { name: messages.console.usersColumnActions }).click()
}

test('path-mode: promoting with a fresh session needs no step-up and revokes the target session', async ({
  browser,
  page,
}) => {
  const adminEmail = uniqueEmail('admin-users-promote')
  await signInAsPathAdmin(page, adminEmail)

  const targetEmail = uniqueEmail('admin-users-promote-target')
  const targetContext = await browser.newContext()
  const targetPage = await targetContext.newPage()
  await registerViaUi(targetPage, targetEmail)
  await expect(targetPage).toHaveURL(isProductHome)

  const stepUpResponses: number[] = []
  page.on('response', (response) => {
    if (response.url().endsWith('/api/console/auth/step-up')) {
      stepUpResponses.push(response.status())
    }
  })

  await page.goto(consolePath('/users'))
  await openRoleMenu(page, targetEmail)
  await page.getByRole('menuitem', { name: messages.console.usersActionPromote }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: messages.console.usersActionPromote })
    .click()

  await expect(
    page
      .getByRole('row')
      .filter({ hasText: targetEmail })
      .getByText(messages.console.superAdminRole)
  ).toBeVisible()
  expect(stepUpResponses).toHaveLength(0)
  expect(countLiveSessions(targetEmail)).toBe(0)

  await targetContext.close()
})

test('path-mode: demoting with an aged session requires step-up, retries automatically, and never exposes a token', async ({
  browser,
  page,
}) => {
  const adminEmail = uniqueEmail('admin-users-demote')
  await signInAsPathAdmin(page, adminEmail)
  ageSessionLastAuthAt(adminEmail)

  const targetEmail = uniqueEmail('admin-users-demote-target')
  const targetContext = await browser.newContext()
  const targetPage = await targetContext.newPage()
  await registerViaUi(targetPage, targetEmail)
  setSystemRole(targetEmail, 'SUPER_ADMIN')

  const stepUpBodies: string[] = []
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/console/auth/step-up')) {
      stepUpBodies.push(await response.text().catch(() => ''))
    }
  })

  await page.goto(consolePath('/users'))
  await openRoleMenu(page, targetEmail)
  await page.getByRole('menuitem', { name: messages.console.usersActionDemote }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: messages.console.usersActionDemote })
    .click()

  const stepUpDialog = page.getByRole('dialog', { name: messages.console.stepUpTitle })
  await expect(stepUpDialog).toBeVisible()
  await stepUpDialog.getByLabel(messages.console.loginPassword, { exact: true }).fill(TEST_PASSWORD)
  await stepUpDialog.getByRole('button', { name: messages.console.stepUpSubmit }).click()
  await completeMfaStepUp(page, adminEmail)

  await expect(stepUpDialog).toBeHidden()
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: targetEmail })
      .getByText(messages.console.usersRoleUser, { exact: true })
  ).toBeVisible()

  expect(stepUpBodies).toHaveLength(2)
  for (const body of stepUpBodies) {
    expect(body).not.toContain('accessToken')
    expect(body).not.toContain('refreshToken')
  }
  expect(await page.content()).not.toContain('accessToken')
  expect(countLiveSessions(targetEmail)).toBe(0)

  await targetContext.close()
})

test('path-mode: a wrong step-up password stays recoverable and leaves the role unchanged', async ({
  browser,
  page,
}) => {
  const adminEmail = uniqueEmail('admin-users-wrongpw')
  await signInAsPathAdmin(page, adminEmail)
  ageSessionLastAuthAt(adminEmail)

  const targetEmail = uniqueEmail('admin-users-wrongpw-target')
  const targetContext = await browser.newContext()
  const targetPage = await targetContext.newPage()
  await registerViaUi(targetPage, targetEmail)
  await targetContext.close()

  await page.goto(consolePath('/users'))
  await openRoleMenu(page, targetEmail)
  await page.getByRole('menuitem', { name: messages.console.usersActionPromote }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: messages.console.usersActionPromote })
    .click()

  const stepUpDialog = page.getByRole('dialog', { name: messages.console.stepUpTitle })
  await expect(stepUpDialog).toBeVisible()
  await stepUpDialog
    .getByLabel(messages.console.loginPassword, { exact: true })
    .fill('DefinitelyWrong123')
  await stepUpDialog.getByRole('button', { name: messages.console.stepUpSubmit }).click()

  await expect(stepUpDialog.getByText(messages.errors.INVALID_CREDENTIALS)).toBeVisible()
  await expect(
    stepUpDialog.getByLabel(messages.console.loginPassword, { exact: true })
  ).toBeVisible()

  await stepUpDialog.getByRole('button', { name: messages.common.cancel }).click()
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: targetEmail })
      .getByText(messages.console.usersRoleUser, { exact: true })
  ).toBeVisible()
})

test('path-mode: self-row never offers a role action', async ({ page }) => {
  const adminEmail = uniqueEmail('admin-users-self')
  await signInAsPathAdmin(page, adminEmail)

  await page.goto(consolePath('/users'))
  const ownRow = page.getByRole('row').filter({ hasText: adminEmail })
  await expect(
    ownRow.getByRole('button', { name: messages.console.usersColumnActions })
  ).toHaveCount(0)
})

test('path-mode: the generic authenticated proxy still rejects auth/step-up directly', async ({
  page,
}) => {
  const adminEmail = uniqueEmail('admin-users-proxy-gap')
  await signInAsPathAdmin(page, adminEmail)

  const response = await page.request.post('/api/auth/step-up', {
    data: { password: TEST_PASSWORD },
  })

  expect(response.status()).toBe(404)
  const body = await response.text()
  expect(body).not.toContain('accessToken')
})
