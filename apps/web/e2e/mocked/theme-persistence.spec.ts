import { expect, test } from '@playwright/test'

/**
 * `shared/lib/theme.ts`'s inline pre-hydration script (Track 2, ADR-064)
 * applies the stored `THEME_STORAGE_KEY` ("amcore-theme") setting before
 * paint, avoiding a light->dark flash. `addInitScript` writes to
 * `localStorage` before any page script runs, the same position a real
 * returning visitor's browser would be in.
 */

test('a stored "dark" theme setting is applied before paint, no flash', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('amcore-theme', 'dark'))

  await page.goto('/en/login')

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe(true)

  const colorScheme = await page.evaluate(() => document.documentElement.style.colorScheme)
  expect(colorScheme).toBe('dark')
})

test('a stored "dark" theme setting persists across reload', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('amcore-theme', 'dark'))
  await page.goto('/en/login')
  await page.reload()

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe(true)
})

test("no stored setting resolves via system preference, not the previous test's leftover state", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/en/login')

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe(false)
})
