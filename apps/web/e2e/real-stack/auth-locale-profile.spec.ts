import { productAdminPath } from '@amcore/shared'
import { test } from '@playwright/test'

import en from '../../messages/en.json'
import ru from '../../messages/ru.json'
import { verifyUrlOnlyLocale } from '../shared/url-only-locale-journey'

import { registerViaUi, uniqueEmail } from './helpers'

for (const path of ['/mfa', productAdminPath('/mfa')]) {
  test(`whole pending MFA document adds no product profile calls: ${path}`, async ({ page }) => {
    await verifyUrlOnlyLocale(page, path, {
      en: en.accountMfa.unavailable,
      ru: ru.accountMfa.unavailable,
    })
  })
}

test('standalone product-admin denied document adds no product profile calls', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('locale-denied'))
  const denied = await page.context().newPage()
  try {
    await verifyUrlOnlyLocale(denied, productAdminPath('/organizations/not-a-valid-id'), {
      en: en.productAdmin.unavailableTitle,
      ru: ru.productAdmin.unavailableTitle,
    })
  } finally {
    await denied.close()
  }
})
