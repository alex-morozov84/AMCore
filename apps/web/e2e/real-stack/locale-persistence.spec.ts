import { expect, test } from '@playwright/test'

import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

test('a locale switch persists to a fresh session on another device/browser', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('locale')

  await registerViaUi(page, email, { name: 'E2E Test' })
  await expect(page).toHaveURL(/\/en\/?$/)

  // `LocaleSwitcher.persistLocale()` is a deliberately-not-awaited
  // best-effort write ("the UI language must switch immediately even if
  // the profile write fails") — the client-side navigation to /ru can
  // complete before the PATCH the assertion below actually depends on
  // does. Wait for that specific response, not just the URL change.
  const localePersisted = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/me') &&
      response.request().method() === 'PATCH' &&
      response.ok()
  )
  await page.getByRole('combobox', { name: /language/i }).selectOption('ru')
  await localePersisted
  await expect(page).toHaveURL(/\/ru\/?$/)

  // A completely fresh context (no cookies, no localStorage) logging in
  // without any locale hint in the URL. Landing on /ru here proves the
  // preference reached `User.locale` server-side via `LocaleSwitcher`'s
  // `PATCH /auth/me` — not just this tab's own cookie/URL state.
  const freshContext = await browser.newContext()
  const freshPage = await freshContext.newPage()
  await loginViaUi(freshPage, email)

  await expect(freshPage).toHaveURL(/\/ru\/?$/)

  await freshContext.close()
})

test('a failed profile save does not block the displayed language change', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('locale-failed-save'), { name: 'E2E Test' })
  await expect(page).toHaveURL(/\/en\/?$/)
  await page.route('**/api/auth/me', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    await route.fulfill({ status: 503, json: { errorCode: 'SERVICE_UNAVAILABLE' } })
  })
  const failed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/me' &&
      response.request().method() === 'PATCH' &&
      response.status() === 503
  )
  await page.getByRole('combobox', { name: /language/i }).selectOption('ru')
  await failed
  await expect(page).toHaveURL(/\/ru\/?$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
  await expect(page.getByRole('combobox')).toHaveValue('ru')
  await expect(page.getByRole('combobox')).toBeEnabled()
})
