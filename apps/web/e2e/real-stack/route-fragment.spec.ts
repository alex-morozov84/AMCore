import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localePathPrefix, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

const messages = JSON.parse(
  readFileSync(join(__dirname, `../../messages/${DEFAULT_LOCALE}.json`), 'utf8')
)

test('production navigation does not restore the initial route fragment on a fragmentless return', async ({
  page,
}) => {
  const prefix = localePathPrefix(DEFAULT_LOCALE)
  await page.goto(`${prefix}/login#initial`)
  await page.getByRole('link', { name: messages.auth.register, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${prefix}/register$`))
  await page.getByRole('link', { name: messages.auth.login, exact: true }).click()
  await expect(page).toHaveURL(`${new URL(page.url()).origin}${prefix}/login`)
  await expect(page.getByRole('button', { name: messages.auth.login, exact: true })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
})

test('production auth messages and validation match the selected project topology', async ({
  page,
}) => {
  await page.goto(`${localePathPrefix(DEFAULT_LOCALE)}/login`)
  await expect(
    page.getByRole('combobox', { name: messages.locale.label, exact: true })
  ).toHaveCount(SUPPORTED_LOCALES.length > 1 ? 1 : 0)
  await page.getByRole('button', { name: messages.auth.login, exact: true }).click()
  await expect(page.getByText(messages.validation.email, { exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', DEFAULT_LOCALE)
})
