import { SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, type Page } from '@playwright/test'

/** Run against production as well: development does not exercise Next's route cache. */
export async function verifyLocaleUrl(page: Page) {
  const first = SUPPORTED_LOCALES[0]
  const second = SUPPORTED_LOCALES.at(-1)!
  expect(first).not.toBe(second)
  const query = '?tag=a&tag=b&encoded=%23value'
  const profileRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/me') {
      profileRequests.push(request.method())
    }
  })
  async function change(locale: string, hash: string) {
    await page.getByRole('combobox').selectOption(locale)
    await expect(page).toHaveURL(`${new URL(page.url()).origin}/${locale}/login${query}${hash}`)
    await expect(page.locator('html')).toHaveAttribute('lang', locale)
    await expect(page.getByRole('combobox')).toHaveValue(locale)
    await expect(page.getByRole('combobox')).toBeEnabled()
  }
  await page.goto(`/${first}/login${query}#first`)
  await change(second, '#first')
  await page.evaluate(() => window.history.replaceState(window.history.state, '', '#second#tail'))
  await change(first, '#second#tail')
  await page.evaluate(() => {
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search
    )
  })
  await change(second, '')
  await page.evaluate(() => window.history.pushState(window.history.state, '', '#history'))
  await change(first, '#history')
  await page.goBack()
  await expect(page.locator('html')).toHaveAttribute('lang', second)
  expect(new URL(page.url()).hash).toBe('')
  await page.goForward()
  await expect(page.locator('html')).toHaveAttribute('lang', first)
  expect(new URL(page.url()).hash).toBe('#history')
  expect(new URL(page.url()).search).toBe(query)
  expect(profileRequests).toEqual([])
}
