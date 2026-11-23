import { SERVED_LOCALES } from '@amcore/shared'
import { expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { requirePathConsole } from '../shared/console-applicability'
import { consolePath, isProductHome, messages, messagesForLocale } from '../shared/product-settings'

import { setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

requirePathConsole()

const JOBS = [
  messages.console.scheduledJobs.jobs['cleanup'].name,
  messages.console.scheduledJobs.jobs['invitation-retention'].name,
  messages.console.scheduledJobs.jobs['notification-retention'].name,
  messages.console.scheduledJobs.jobs['geoip-update'].name,
  messages.console.scheduledJobs.jobs['notification-recovery'].name,
  messages.console.scheduledJobs.jobs['ai-run-recovery'].name,
  messages.console.scheduledJobs.jobs['ai-approval-expiry'].name,
  messages.console.scheduledJobs.jobs['invitation-handoff-sweep'].name,
  messages.console.scheduledJobs.jobs['background-control-maintenance'].name,
]

async function signInAsSuperAdmin(page: Page, prefix: string) {
  const email = uniqueEmail(prefix)
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(isProductHome)
  return email
}

test('path-mode Scheduled jobs lists every job from the real worker with result and freshness apart', async ({
  page,
}) => {
  await signInAsSuperAdmin(page, 'admin-scheduled-jobs')
  await page.goto(consolePath(''))
  await page.getByRole('link', { name: messages.console.scheduledJobs.title, exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === consolePath('/scheduled-jobs'))
  await expect(
    page.getByRole('heading', { name: messages.console.scheduledJobs.title, level: 1 })
  ).toBeVisible()

  const table = page.getByRole('table', { name: messages.console.scheduledJobs.title })
  for (const name of JOBS) await expect(table.getByText(name, { exact: true })).toBeVisible()
  // The worker of this stack registers its jobs, so nobody is "not reported".
  await expect(page.getByText(messages.console.scheduledJobs.nobodyReported)).not.toBeVisible()
  // GeoIP is off in the stack: a turned-off job says so and carries no verdict.
  const geoip = table
    .getByRole('row')
    .filter({ hasText: messages.console.scheduledJobs.jobs['geoip-update'].name })
  await expect(geoip).toContainText(messages.console.scheduledJobs.freshness.disabled)
  // A job that runs every 30 seconds reports a real success once the worker has run it.
  const recovery = table
    .getByRole('row')
    .filter({ hasText: messages.console.scheduledJobs.jobs['notification-recovery'].name })
  await expect(recovery).toContainText(messages.console.scheduledJobs.freshness.fresh)
  await expect(async () => {
    await page
      .getByRole('button', { name: messages.console.scheduledJobs.refresh, exact: true })
      .click()
    await expect(recovery).toContainText(messages.console.scheduledJobs.result.success, {
      timeout: 2000,
    })
  }).toPass({ timeout: 120_000 })
  await expect(page.getByText(messages.console.scheduledJobs.frequentFootnote)).toHaveCount(1)

  const observed = page.locator('time').first()
  const before = await observed.getAttribute('datetime')
  await page
    .getByRole('button', { name: messages.console.scheduledJobs.refresh, exact: true })
    .click()
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
  await page.goto(consolePath('/scheduled-jobs'))
  await expect(
    page.getByRole('heading', { name: messages.console.scheduledJobs.title, level: 1 })
  ).toBeVisible()
  expect(historyReads).toHaveLength(0)

  const cleanup = page
    .getByRole('table', { name: messages.console.scheduledJobs.title })
    .getByRole('row')
    .filter({ hasText: messages.console.scheduledJobs.jobs['cleanup'].name })
  await page.getByText(messages.console.scheduledJobs.history.title).first().click()
  await expect(page.getByText(messages.console.scheduledJobs.history.empty)).toBeVisible()
  expect(historyReads).toHaveLength(1)
  await expect(cleanup).toBeVisible()
  await expectNoAxeViolations(page)

  // An opened history follows the page: a manual refresh reads it again.
  await page
    .getByRole('button', { name: messages.console.scheduledJobs.refresh, exact: true })
    .click()
  await expect.poll(() => historyReads.length).toBe(2)
  await expect(page.getByText(messages.console.scheduledJobs.history.empty)).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('table', { name: messages.console.scheduledJobs.title })).toBeHidden()
  await expect(page.getByRole('list', { name: messages.console.scheduledJobs.title })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
  await expectNoAxeViolations(page)
})

test('path-mode Scheduled jobs is available in Russian and denies a demoted session', async ({
  page,
}) => {
  const email = await signInAsSuperAdmin(page, 'admin-scheduled-jobs-ru')
  const reviewLocale = SERVED_LOCALES.at(-1)!
  const reviewMessages = messagesForLocale(reviewLocale)
  await page.goto(consolePath('/scheduled-jobs', reviewLocale))
  await expect(
    page.getByRole('heading', { name: reviewMessages.console.scheduledJobs.title, level: 1 })
  ).toBeVisible()
  await expect(
    page
      .getByRole('table', { name: reviewMessages.console.scheduledJobs.title })
      .getByText(reviewMessages.console.scheduledJobs.jobs['notification-recovery'].name)
  ).toBeVisible()

  setSystemRole(email, 'USER')
  const response = await page.goto(consolePath('/scheduled-jobs'))
  expect(response?.status()).toBe(404)
})
