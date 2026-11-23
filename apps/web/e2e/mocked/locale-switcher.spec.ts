import { DEFAULT_LOCALE, SERVED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { verifyLocaleUrl } from '../shared/locale-switcher-journey'
import { messagesForLocale, productPath } from '../shared/product-settings'

test('locale navigation preserves query, event-time fragment and history', async ({ page }) => {
  await verifyLocaleUrl(page)
})

const alternate = SERVED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE)
if (alternate) {
  const locale = alternate
  test('native keyboard typeahead changes locale while focus and Escape do not navigate', async ({
    page,
  }) => {
    await page.goto(productPath('/login', 'ru'))
    await page.locator('html[data-route-progress-ready]').waitFor()
    const selector = page.getByRole('combobox', {
      name: messagesForLocale('ru').locale.label,
      exact: true,
    })
    await selector.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(selector).toBeFocused()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
    await selector.pressSequentially('e')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.getByRole('combobox').press('Escape')
    await expect(page).toHaveURL(productPath('/login', 'en'))
  })

  test('a pending locale choice stays selected and disables further selection', async ({
    page,
  }) => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(
      (url) => url.pathname === productPath('/login', locale),
      async (route) => {
        await blocked
        await route.continue()
      }
    )
    try {
      await page.goto(productPath('/login'))
      await page.locator('html[data-route-progress-ready]').waitFor()
      await page.getByRole('combobox').selectOption(locale)
      await expect(page.getByRole('combobox')).toHaveValue(locale)
      await expect(page.getByRole('combobox')).toBeDisabled()
      await expect(page.getByTestId('route-progress-bar')).toBeVisible()
      release()
      await expect(page.locator('html')).toHaveAttribute('lang', locale)
      await expect(page.getByRole('combobox')).toBeEnabled()
      await expect(page.getByTestId('route-progress-bar')).toBeHidden({ timeout: 2000 })
    } finally {
      release()
    }
  })
}
