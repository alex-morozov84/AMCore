import { test } from '@playwright/test'

import en from '../../messages/en.json'
import ru from '../../messages/ru.json'
import { verifyUrlOnlyLocale } from '../shared/url-only-locale-journey'

test('whole host-Console pending MFA document adds no product profile calls', async ({ page }) => {
  await verifyUrlOnlyLocale(page, '/mfa', {
    title: { en: en.meta.title, ru: ru.meta.title },
    en: en.accountMfa.sessionChanged,
    ru: ru.accountMfa.sessionChanged,
  })
})
