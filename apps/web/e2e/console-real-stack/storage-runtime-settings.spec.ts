import { expect, test } from '@playwright/test'

import { loginViaUi, registerViaUi, uniqueEmail } from '../real-stack/helpers'
import { isProductHome, productPath } from '../shared/product-settings'
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
    await expect(page).toHaveURL(isProductHome)
    setSystemRole(email, 'SUPER_ADMIN')
    const operator = await console.newPage()
    // Protected pages intentionally fail closed before the separate host login.
    expect((await operator.goto(productPath()))?.status()).toBe(404)
    await loginViaUi(operator, email, { mfa: 'required', surface: 'console' })
    await expect(operator).toHaveURL(isProductHome)
    await storageSettingJourney(operator, '/api/runtime-settings/storage-probe')
  } finally {
    await product.close()
    await console.close()
  }
})
