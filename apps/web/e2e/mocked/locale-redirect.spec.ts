import { DEFAULT_LOCALE, SERVED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { productPath } from '../shared/product-settings'

for (const { locale, preference, group, title } of [
  {
    locale: 'en',
    preference: 'en-US',
    group: 'locale redirect',
    title: 'redirects "/" to "/en" for an English browser',
  },
  {
    locale: 'ru',
    preference: 'ru-RU',
    group: 'locale redirect — Russian',
    title: 'redirects "/" to "/ru" for a Russian browser',
  },
] as const) {
  test.describe(group, () => {
    test.use({ locale: preference })

    test(title, async ({ page }) => {
      const expected = SERVED_LOCALES.find((served) => served === locale) ?? DEFAULT_LOCALE
      await page.goto('/')
      await expect(page).toHaveURL(productPath('/login', expected))
      await expect(page.locator('html')).toHaveAttribute('lang', expected)
    })
  })
}
