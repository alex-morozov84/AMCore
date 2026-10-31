import { DEFAULT_LOCALE, localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { activeTarget } from '../support/managed-target.mjs'

import { uniqueEmail } from './helpers'
import { inviteRecipient, membershipCount } from './invitation-recipient.helpers'
import { resetInvitationRegistrationIpBudget } from './invitation-registration-budget.helpers'
import { pauseRedis } from './redis-outage-support'

// Characterization, not a 3 s promise: the invitation record store stays on the web server's shared
// Redis connection (only the session vault, its lock and the refresh moved to the supervised one).
// A link opened while Redis stalls therefore waits for the stall to end and then opens the flow.
// Asserted: the flow opens within an upper bound and no membership exists. Not asserted: the
// invitation's consumed state or anything during the pause. Numbers are for this fault class here.
test.beforeEach(() => resetInvitationRegistrationIpBudget())

const STALL_MS = 8000
const MARGIN_MS = 7000

test('an invitation link opened during a Redis stall waits for Redis, then opens the flow with no membership', async ({
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
  const prefix = SUPPORTED_LOCALES.length > 1 ? `/${DEFAULT_LOCALE}` : ''

  pauseRedis(STALL_MS)
  const started = performance.now()
  await page.goto(link, { timeout: STALL_MS + MARGIN_MS })
  const elapsed = performance.now() - started
  expect(elapsed).toBeLessThan(STALL_MS + MARGIN_MS)
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
