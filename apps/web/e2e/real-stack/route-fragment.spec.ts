import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localePathPrefix } from '@amcore/shared'
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
