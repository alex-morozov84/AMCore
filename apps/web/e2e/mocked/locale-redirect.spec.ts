import { expect, test } from '@playwright/test'

/**
 * `localePrefix: 'always'` (`src/i18n/routing.ts`) means `/` never renders
 * directly — it always redirects to an explicit `/{locale}` path, resolved
 * from `Accept-Language` on the first visit. No mocking needed: this is
 * pure browser-originating routing, grouped into the mocked lane for its
 * infra cost, not because anything is intercepted.
 */

test.describe('locale redirect', () => {
  test.use({ locale: 'en-US' })

  test('redirects "/" to "/en" for an English browser', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/en(\/|$)/)
  })
})

test.describe('locale redirect — Russian', () => {
  test.use({ locale: 'ru-RU' })

  test('redirects "/" to "/ru" for a Russian browser', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/ru(\/|$)/)
  })
})
