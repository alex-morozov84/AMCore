import { DEFAULT_LOCALE, localePathPrefix, SERVED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { isProductHome, messages } from '../shared/product-settings'

import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

const second = SERVED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE)

test('a locale switch persists to a fresh session on another device/browser', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('locale')

  await registerViaUi(page, email, { name: 'E2E Test' })
  await expect(page).toHaveURL(isProductHome)

  if (!second) {
    await expect(
      page.getByRole('combobox', { name: messages.locale.label, exact: true })
    ).toHaveCount(0)
    const freshContext = await browser.newContext()
    try {
      const freshPage = await freshContext.newPage()
      await loginViaUi(freshPage, email)
      await expect(freshPage).toHaveURL(isProductHome)
      await expect(freshPage.locator('html')).toHaveAttribute('lang', DEFAULT_LOCALE)
    } finally {
      await freshContext.close()
    }
    return
  }

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
  await page
    .getByRole('combobox', { name: messages.locale.label, exact: true })
    .selectOption(second!)
  await localePersisted
  await expect(page).toHaveURL(
    (url) => url.pathname.replace(/\/$/, '') === localePathPrefix(second!)
  )

  // A completely fresh context (no cookies, no localStorage) logging in
  // without any locale hint in the URL. Landing on /ru here proves the
  // preference reached `User.locale` server-side via `LocaleSwitcher`'s
  // `PATCH /auth/me` — not just this tab's own cookie/URL state.
  const freshContext = await browser.newContext()
  const freshPage = await freshContext.newPage()
  await loginViaUi(freshPage, email)

  await expect(freshPage).toHaveURL(
    (url) => url.pathname.replace(/\/$/, '') === localePathPrefix(second!)
  )

  await freshContext.close()
})

test.describe(() => {
  test.skip(!second, 'requires:multiple-locales')
  test('a failed profile save does not block the displayed language change', async ({ page }) => {
    await registerViaUi(page, uniqueEmail('locale-failed-save'), { name: 'E2E Test' })
    await expect(page).toHaveURL(isProductHome)
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
    await page
      .getByRole('combobox', { name: messages.locale.label, exact: true })
      .selectOption(second!)
    await failed
    await expect(page).toHaveURL(
      (url) => url.pathname.replace(/\/$/, '') === localePathPrefix(second!)
    )
    await expect(page.locator('html')).toHaveAttribute('lang', second!)
    await expect(page.getByRole('combobox')).toHaveValue(second!)
    await expect(page.getByRole('combobox')).toBeEnabled()
  })
})
