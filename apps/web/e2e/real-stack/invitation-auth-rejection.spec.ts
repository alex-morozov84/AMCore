import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { messages } from '../shared/product-settings'
import { activeTarget } from '../support/managed-target.mjs'

import { TEST_PASSWORD, uniqueEmail } from './helpers'
import { inviteRecipient } from './invitation-recipient.helpers'

test('recipient known429 synchronizes without replaying credentials', async ({ page }) => {
  const target = activeTarget()
  const email = uniqueEmail('known-rejection')
  const { token } = await inviteRecipient(email)
  await page.goto(
    localizedFrontendUrl(target.origins.product, DEFAULT_LOCALE, `invite/accept?token=${token}`)
  )
  const panel = page.getByRole('tabpanel', { name: messages.auth.login, exact: true })
  await panel.getByLabel(messages.auth.password, { exact: true }).fill(TEST_PASSWORD)
  let submissions = 0
  await page.route('**/api/invitation-flows/*/login', async (route) => {
    submissions++
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'retry-after': '1' },
      body: JSON.stringify({ errorCode: 'RATE_LIMIT_EXCEEDED', statusCode: 429 }),
    })
  })
  const synchronization = page.waitForResponse((r) =>
    new URL(r.url()).pathname.endsWith('/context')
  )
  await panel.getByRole('button', { name: messages.auth.login, exact: true }).click()
  expect((await synchronization).status()).toBe(200)
  await expect(panel.getByRole('button', { name: messages.auth.login, exact: true })).toBeEnabled()
  await expect(
    page.getByRole('heading', { name: messages.invitationRecipient.signInTitle, exact: true })
  ).toBeVisible()
  expect(submissions).toBe(1)
})
