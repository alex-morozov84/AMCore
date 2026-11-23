import { expect, test } from '@playwright/test'

import { isProductHome, messages, productPath } from '../shared/product-settings'

import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

test('active sessions: no revoke control on the current session, can revoke another', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('sessions')

  await registerViaUi(page, email, { name: 'E2E Test' })
  await expect(page).toHaveURL(isProductHome)

  await page.goto(productPath('/settings/sessions'))
  await expect(page.getByRole('table')).toBeVisible()
  // One real session so far (this one) — the current row never gets a
  // row-actions menu (`SessionsTable.tsx`'s `RowActions`).
  await expect(
    page.getByRole('button', { name: messages.sessions.actions, exact: true })
  ).toHaveCount(0)

  // A second real session for the same account, from an isolated context —
  // a real second login, not a fabricated row.
  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  await loginViaUi(otherPage, email)
  await expect(otherPage).toHaveURL(isProductHome)

  await page.reload()
  await expect(
    page.getByRole('button', { name: messages.sessions.actions, exact: true })
  ).toHaveCount(1)

  await page.getByRole('button', { name: messages.sessions.actions, exact: true }).click()
  await page.getByRole('menuitem', { name: messages.sessions.revoke, exact: true }).click()
  await expect(
    page.getByRole('button', { name: messages.sessions.actions, exact: true })
  ).toHaveCount(0)

  await otherContext.close()
})
