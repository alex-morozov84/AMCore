import { expect, test } from '@playwright/test'

import { DEFAULT_THEME_SETTING, resolveTheme } from '../../src/shared/lib/theme'
import { fixedTheme } from '../../src/shared/lib/theme-availability'
import { productPath } from '../shared/product-settings'

/**
 * `shared/lib/theme.ts`'s inline pre-hydration script (Track 2, ADR-064)
 * applies the stored `THEME_STORAGE_KEY` ("amcore-theme") setting before
 * paint, avoiding a light->dark flash. `addInitScript` writes to
 * `localStorage` before any page script runs, the same position a real
 * returning visitor's browser would be in.
 * Fixed theme settings override the stored preference. Keep these test titles
 * stable because the configured browser inventory compares case IDs with main.
 */

test('a stored "dark" theme setting is applied before paint, no flash', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('amcore-theme', 'dark'))

  await page.goto(productPath('/login'))

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe((fixedTheme() ?? 'dark') === 'dark')

  const colorScheme = await page.evaluate(() => document.documentElement.style.colorScheme)
  expect(colorScheme).toBe(fixedTheme() ?? 'dark')
})

test('a stored "dark" theme setting persists across reload', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('amcore-theme', 'dark'))
  await page.goto(productPath('/login'))
  await page.reload()

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe((fixedTheme() ?? 'dark') === 'dark')
})

test("no stored setting resolves via system preference, not the previous test's leftover state", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(productPath('/login'))

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe((fixedTheme() ?? resolveTheme(DEFAULT_THEME_SETTING, false)) === 'dark')
})
