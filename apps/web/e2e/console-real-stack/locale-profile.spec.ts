import { test } from '@playwright/test'

import en from '../../messages/en.json'
import ru from '../../messages/ru.json'
import { verifyUrlOnlyLocale } from '../shared/url-only-locale-journey'

test('whole host-Console pending MFA document adds no product profile calls', async ({ page }) => {
  await verifyUrlOnlyLocale(page, '/mfa', {
    en: en.accountMfa.unavailable,
    ru: ru.accountMfa.unavailable,
  })
})
