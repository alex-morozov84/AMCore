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
 */

test('first paint applies the fixed or stored theme', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('amcore-theme', 'dark'))

  await page.goto(productPath('/login'))

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe((fixedTheme() ?? 'dark') === 'dark')

  const colorScheme = await page.evaluate(() => document.documentElement.style.colorScheme)
  expect(colorScheme).toBe(fixedTheme() ?? 'dark')
})

test('fixed or stored theme persists across reload', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('amcore-theme', 'dark'))
  await page.goto(productPath('/login'))
  await page.reload()

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe((fixedTheme() ?? 'dark') === 'dark')
})

test('without stored settings the site applies the fixed or default theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(productPath('/login'))

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe((fixedTheme() ?? resolveTheme(DEFAULT_THEME_SETTING, false)) === 'dark')
})
