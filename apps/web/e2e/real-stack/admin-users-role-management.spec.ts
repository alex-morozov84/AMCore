import { expect, type Page, test } from '@playwright/test'

import { ageSessionLastAuthAt, countLiveSessions, setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, TEST_PASSWORD, uniqueEmail } from './helpers'

async function signInAsPathAdmin(page: Page, email: string) {
  await registerViaUi(page, email, { name: 'Role Management Admin' })
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
}

async function openRoleMenu(page: Page, targetEmail: string) {
  const row = page.getByRole('row').filter({ hasText: targetEmail })
  await row.getByRole('button', { name: /actions/i }).click()
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
  await expect(targetPage).toHaveURL(/\/en\/?$/)

  const stepUpResponses: number[] = []
  page.on('response', (response) => {
    if (response.url().endsWith('/api/console/auth/step-up')) {
      stepUpResponses.push(response.status())
    }
  })

  await page.goto('/en/admin/users')
  await openRoleMenu(page, targetEmail)
  await page.getByRole('menuitem', { name: /promote to admin/i }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /promote to admin/i })
    .click()

  await expect(
    page.getByRole('row').filter({ hasText: targetEmail }).getByText('Super admin')
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

  await page.goto('/en/admin/users')
  await openRoleMenu(page, targetEmail)
  await page.getByRole('menuitem', { name: /remove admin access/i }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /remove admin access/i })
    .click()

  const stepUpDialog = page.getByRole('dialog', { name: /confirm your password/i })
  await expect(stepUpDialog).toBeVisible()
  await stepUpDialog.getByLabel(/password/i).fill(TEST_PASSWORD)
  await stepUpDialog.getByRole('button', { name: /confirm/i }).click()

  await expect(stepUpDialog).toBeHidden()
  await expect(
    page.getByRole('row').filter({ hasText: targetEmail }).getByText('User', { exact: true })
  ).toBeVisible()

  expect(stepUpBodies).toHaveLength(1)
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

  await page.goto('/en/admin/users')
  await openRoleMenu(page, targetEmail)
  await page.getByRole('menuitem', { name: /promote to admin/i }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /promote to admin/i })
    .click()

  const stepUpDialog = page.getByRole('dialog', { name: /confirm your password/i })
  await expect(stepUpDialog).toBeVisible()
  await stepUpDialog.getByLabel(/password/i).fill('DefinitelyWrong123')
  await stepUpDialog.getByRole('button', { name: /confirm/i }).click()

  await expect(stepUpDialog.getByText(/incorrect email or password/i)).toBeVisible()
  await expect(stepUpDialog.getByLabel(/password/i)).toBeVisible()

  await stepUpDialog.getByRole('button', { name: /cancel/i }).click()
  await expect(
    page.getByRole('row').filter({ hasText: targetEmail }).getByText('User', { exact: true })
  ).toBeVisible()
})

test('path-mode: self-row never offers a role action', async ({ page }) => {
  const adminEmail = uniqueEmail('admin-users-self')
  await signInAsPathAdmin(page, adminEmail)

  await page.goto('/en/admin/users')
  const ownRow = page.getByRole('row').filter({ hasText: adminEmail })
  await expect(ownRow.getByRole('button', { name: /actions/i })).toHaveCount(0)
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
