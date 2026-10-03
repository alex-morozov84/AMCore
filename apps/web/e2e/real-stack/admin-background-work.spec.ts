import { expect, test } from '@playwright/test'

import {
  backgroundWorkDegradedJourney,
  backgroundWorkJourney,
  backgroundWorkRetryAfterJourney,
} from '../shared/background-work-journey'
import { settingsProof } from '../support/runtime-settings-proof'

import { setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

const URL = '/en/admin/background-work'

async function signInAsOperator(page: Parameters<typeof registerViaUi>[0], label: string) {
  const email = uniqueEmail(label)
  await registerViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
}

test('path-mode Background work: first snapshot, live refresh, manual refresh, responsive and accessible', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await signInAsOperator(page, 'admin-background-work')
  await backgroundWorkJourney(page, URL)
})

test('path-mode Background work: unreadable queues are data, not empty, and back off', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await signInAsOperator(page, 'admin-background-work-degraded')
  await backgroundWorkDegradedJourney(page, URL)
})

test('path-mode Background work: a short Retry-After frees manual Refresh before the automatic backoff ends', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await signInAsOperator(page, 'admin-background-work-retry-after')
  await backgroundWorkRetryAfterJourney(page, URL)
})

test('path-mode Background work: an ordinary user never sees it', async ({ page }) => {
  const email = uniqueEmail('admin-background-work-user')
  await registerViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  const response = await page.goto(URL)
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Background work' })).toHaveCount(0)
  await expect(page.getByRole('table', { name: 'Background queues' })).toHaveCount(0)
})

test('path-mode Background work shows no rows while Redis stalls and recovers afterwards', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await signInAsOperator(page, 'admin-background-work-outage')
  settingsProof('pause-redis') // CLIENT PAUSE 40000 ALL on the stand's own Redis
  // Admission/limiter commands stall: the request either times out or answers without queue rows.
  const body = await page.request
    .get(URL, { timeout: 8_000 })
    .then((response) => response.text())
    .catch(() => 'stalled')
  expect(body).not.toContain('Background queues')
  expect(body).not.toContain('data-slot="table"')
  // After the stall ends the screen works again without any manual intervention.
  await expect(async () => {
    await page.goto(URL)
    await expect(page.getByRole('table', { name: 'Background queues' })).toBeVisible()
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] })
})
