import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'
import { storageSettingJourney } from '../shared/storage-setting-journey'
import { activeTarget } from '../support/managed-target.mjs'

import { setSystemRole } from './helpers'

test('Overview Edit/Cancel/Save and operator reset in HTTPS host topology', async ({ browser }) => {
  const target = activeTarget()
  const email = uniqueEmail('storage-setting-host')
  const product = await browser.newContext({
    baseURL: target.origins.product,
    ignoreHTTPSErrors: true,
  })
  const console = await browser.newContext({
    baseURL: target.origins.console,
    ignoreHTTPSErrors: true,
  })
  try {
    const page = await product.newPage()
    await registerViaUi(page, email)
    await expect(page).toHaveURL(/\/en\/?$/)
    setSystemRole(email, 'SUPER_ADMIN')
    const operator = await console.newPage()
    // Protected pages intentionally fail closed before the separate host login.
    expect((await operator.goto('/en'))?.status()).toBe(404)
    await operator.goto('/en/login')
    await operator.getByLabel(/email/i).fill(email)
    await operator.getByLabel(/password/i).fill('Test1234Secure')
    await operator.getByRole('button', { name: /sign in/i }).click()
    await expect(operator).toHaveURL(/\/en\/?$/)
    await storageSettingJourney(operator, '/api/runtime-settings/storage-probe')
  } finally {
    await product.close()
    await console.close()
  }
})
