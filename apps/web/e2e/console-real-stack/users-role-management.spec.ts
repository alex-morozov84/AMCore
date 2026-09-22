import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'

import { registerViaUi, TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'

import { ageSessionLastAuthAt, countLiveSessions, setSystemRole } from './helpers'

async function registerOnProduct(browser: Browser, email: string): Promise<void> {
  const product = await browser.newContext({
    baseURL: 'https://app.localhost',
    ignoreHTTPSErrors: true,
  })
  const page = await product.newPage()
  await registerViaUi(page, email)
  await expect(page).toHaveURL(/https:\/\/app\.localhost\/en\/?$/)
  await product.close()
}

async function signInToConsole(
  browser: Browser,
  email: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: 'https://console.localhost',
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()
  await page.goto('/en/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/https:\/\/console\.localhost\/en\/?$/)
  return { context, page }
}

async function openRoleMenu(page: Page, targetEmail: string) {
  const row = page.getByRole('row').filter({ hasText: targetEmail })
  await row.getByRole('button', { name: /actions/i }).click()
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

  await admin.page.goto('/en/users')
  await openRoleMenu(admin.page, targetEmail)
  await admin.page.getByRole('menuitem', { name: /promote to admin/i }).click()
  await admin.page
    .getByRole('alertdialog')
    .getByRole('button', { name: /promote to admin/i })
    .click()

  await expect(
    admin.page.getByRole('row').filter({ hasText: targetEmail }).getByText('Super admin')
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

  await admin.page.goto('/en/users')
  await openRoleMenu(admin.page, targetEmail)
  await admin.page.getByRole('menuitem', { name: /remove admin access/i }).click()
  await admin.page
    .getByRole('alertdialog')
    .getByRole('button', { name: /remove admin access/i })
    .click()

  const stepUpDialog = admin.page.getByRole('dialog', { name: /confirm your password/i })
  await expect(stepUpDialog).toBeVisible()
  await stepUpDialog.getByLabel(/password/i).fill(TEST_PASSWORD)
  await stepUpDialog.getByRole('button', { name: /confirm/i }).click()

  await expect(stepUpDialog).toBeHidden()
  await expect(
    admin.page.getByRole('row').filter({ hasText: targetEmail }).getByText('User', { exact: true })
  ).toBeVisible()

  expect(stepUpBodies).toHaveLength(1)
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

  await admin.page.goto('/en/users')
  const ownRow = admin.page.getByRole('row').filter({ hasText: adminEmail })
  await expect(ownRow.getByRole('button', { name: /actions/i })).toHaveCount(0)

  await admin.context.close()
})
