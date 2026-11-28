import { DEFAULT_LOCALE, localizedFrontendUrl, SERVED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { activeTarget } from '../support/managed-target.mjs'

import { uniqueEmail } from './helpers'
import { inviteRecipient, membershipCount } from './invitation-recipient.helpers'
import { resetInvitationRegistrationIpBudget } from './invitation-registration-budget.helpers'
import { pauseRedis, waitForRedisAfterPause } from './redis-outage-support'

test.beforeEach(() => resetInvitationRegistrationIpBudget())

const STALL_MS = 8000
const MARGIN_MS = 7000

test('an invitation link is temporarily unavailable during a Redis stall and opens after recovery', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const target = activeTarget()
  const email = uniqueEmail('invited-stall')
  const { org, token } = await inviteRecipient(email)
  const link = localizedFrontendUrl(
    target.origins.product,
    DEFAULT_LOCALE,
    `invite/accept?token=${token}`
  )
  const prefix = SERVED_LOCALES.length > 1 ? `/${DEFAULT_LOCALE}` : ''

  pauseRedis(STALL_MS)
  const started = performance.now()
  await page.goto(link, { timeout: STALL_MS + MARGIN_MS })
  expect(performance.now() - started).toBeLessThan(STALL_MS)
  const unavailable = new URL(
    localizedFrontendUrl(target.origins.product, DEFAULT_LOCALE, 'invite/unusable')
  )
  unavailable.searchParams.set('reason', 'unavailable')
  await expect(page).toHaveURL(unavailable.href)
  expect(membershipCount(email, org.id)).toBe('0')

  await waitForRedisAfterPause(STALL_MS + MARGIN_MS)
  await page.goto(link)
  await expect(page).toHaveURL(
    (url) =>
      url.origin === target.origins.product &&
      url.search === '' &&
      url.hash === '' &&
      new RegExp(`^${prefix}/invite/flow/[A-Za-z0-9_-]{22}$`).test(url.pathname)
  )
  expect(page.url()).not.toContain(token)
  expect(membershipCount(email, org.id)).toBe('0')
})
