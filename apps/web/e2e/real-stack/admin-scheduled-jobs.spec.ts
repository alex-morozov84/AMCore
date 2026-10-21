import { expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

import { setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

const JOBS = [
  'Cleanup of expired records',
  'Cleanup of invitation records',
  'Cleanup of old notifications',
  'GeoIP database update',
  'Notification recovery',
  'AI run recovery',
  'AI approval expiry',
  'Invitation sign-in sweep',
  'Background work command upkeep',
]

async function signInAsSuperAdmin(page: Page, prefix: string) {
  const email = uniqueEmail(prefix)
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  return email
}

test('path-mode Scheduled jobs lists every job from the real worker with result and freshness apart', async ({
  page,
}) => {
  await signInAsSuperAdmin(page, 'admin-scheduled-jobs')
  await page.goto('/en/admin')
  await page.getByRole('link', { name: 'Scheduled jobs', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/admin\/scheduled-jobs$/)
  await expect(page.getByRole('heading', { name: 'Scheduled jobs', level: 1 })).toBeVisible()

  const table = page.getByRole('table', { name: 'Scheduled jobs' })
  for (const name of JOBS) await expect(table.getByText(name, { exact: true })).toBeVisible()
  // The worker of this stack registers its jobs, so nobody is "not reported".
  await expect(page.getByText(/No worker has reported these jobs yet/)).not.toBeVisible()
  // GeoIP is off in the stack: a turned-off job says so and carries no verdict.
  const geoip = table.getByRole('row').filter({ hasText: 'GeoIP database update' })
  await expect(geoip).toContainText('Turned off')
  // A job that runs every 30 seconds reports a real success once the worker has run it.
  const recovery = table.getByRole('row').filter({ hasText: 'Notification recovery' })
  await expect(recovery).toContainText('On time')
  await expect(async () => {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(recovery).toContainText('Success', { timeout: 2000 })
  }).toPass({ timeout: 120_000 })
  await expect(page.getByText(/current run is not tracked/)).toHaveCount(1)

  const observed = page.locator('time').first()
  const before = await observed.getAttribute('datetime')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(observed).not.toHaveAttribute('datetime', before!)

  await expectNoAxeViolations(page)
})

test('path-mode Scheduled jobs reads history only when opened and keeps the narrow layout readable', async ({
  page,
}) => {
  await signInAsSuperAdmin(page, 'admin-scheduled-jobs-history')
  const historyReads: string[] = []
  page.on('request', (request) => {
    if (/\/api\/.*scheduled-jobs\/.+\/runs/.test(request.url())) historyReads.push(request.url())
  })
  await page.goto('/en/admin/scheduled-jobs')
  await expect(page.getByRole('heading', { name: 'Scheduled jobs', level: 1 })).toBeVisible()
  expect(historyReads).toHaveLength(0)

  const cleanup = page
    .getByRole('table', { name: 'Scheduled jobs' })
    .getByRole('row')
    .filter({ hasText: 'Cleanup of expired records' })
  await page.getByText('Run history').first().click()
  await expect(page.getByText('No runs recorded yet.')).toBeVisible()
  expect(historyReads).toHaveLength(1)
  await expect(cleanup).toBeVisible()
  await expectNoAxeViolations(page)

  // An opened history follows the page: a manual refresh reads it again.
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect.poll(() => historyReads.length).toBe(2)
  await expect(page.getByText('No runs recorded yet.')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('table', { name: 'Scheduled jobs' })).toBeHidden()
  await expect(page.getByRole('list', { name: 'Scheduled jobs' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
  await expectNoAxeViolations(page)
})

test('path-mode Scheduled jobs is available in Russian and denies a demoted session', async ({
  page,
}) => {
  const email = await signInAsSuperAdmin(page, 'admin-scheduled-jobs-ru')
  await page.goto('/ru/admin/scheduled-jobs')
  await expect(page.getByRole('heading', { name: 'Регламентные задания', level: 1 })).toBeVisible()
  await expect(
    page
      .getByRole('table', { name: 'Регламентные задания' })
      .getByText('Восстановление уведомлений')
  ).toBeVisible()

  setSystemRole(email, 'USER')
  const response = await page.goto('/en/admin/scheduled-jobs')
  expect(response?.status()).toBe(404)
})
