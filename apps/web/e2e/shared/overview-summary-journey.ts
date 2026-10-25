import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, type Page } from '@playwright/test'

import { activeTarget } from '../support/managed-target.mjs'

import { expectNoAxeViolations } from './axe'
const catalogue = (locale: string) =>
  JSON.parse(
    readFileSync(join(activeTarget().snapshot, `apps/web/messages/${locale}.json`), 'utf8')
  )
const t = catalogue(DEFAULT_LOCALE).console
const common = catalogue(DEFAULT_LOCALE).common
const secondary = catalogue(
  new Set<string>(SUPPORTED_LOCALES).has('ru') ? 'ru' : DEFAULT_LOCALE
).console
type Mode = (value: string) => unknown
const card = (page: Page) => page.locator('[aria-labelledby="overview-attention-title"]')
export async function summaryFaultJourney(page: Page, mode: Mode, assertReads: () => void) {
  mode('empty')
  await page.goto('/en/admin')
  await expect(card(page)).toContainText(t.problems.empty)
  assertReads()
  mode('queues500')
  await page.goto('/en/admin')
  await expect(card(page)).toContainText(t.problems.gaps)
  await expect(card(page)).toContainText(t.problems.sourceUnavailable)
  await expect(page.getByRole('heading', { name: t.overviewDiskTitle, exact: true })).toBeVisible()
  mode('all500')
  await page.goto('/en/admin')
  await expect(card(page)).toContainText(t.problems.unavailable)
  await expect(page.getByRole('button', { name: t.overviewRefresh, exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: common.retry, exact: true })).toHaveCount(0)
  mode('retry')
  await page.goto('/en/admin')
  await expect(page.getByRole('button', { name: t.overviewRefresh, exact: true })).toBeDisabled()
  await expect(
    page.getByText(new RegExp(t.problems.retryWait.split('{seconds,')[0] + '\\d+'))
  ).toBeVisible()
  mode('empty')
  await expect(page.getByRole('button', { name: t.overviewRefresh, exact: true })).toBeEnabled({
    timeout: 5000,
  })
  await page.getByRole('button', { name: t.overviewRefresh, exact: true }).click()
  await expect(card(page)).toContainText(t.problems.empty)
  mode('slow')
  const refreshed = page.waitForResponse(
    (r) => r.request().headers()['rsc'] === '1' && r.status() === 200
  )
  await page.getByRole('button', { name: t.overviewRefresh, exact: true }).click()
  await expect(card(page)).toBeVisible()
  await expect(page.getByRole('button', { name: t.overviewRefreshing, exact: true })).toBeDisabled()
  await refreshed
  await expect(page.getByRole('button', { name: t.overviewRefresh, exact: true })).toBeEnabled()
  for (const fault of ['integrations401', 'malformed']) {
    mode(fault)
    await page.goto('/en/admin')
    await expect(card(page)).toHaveCount(0)
    await expect(page.getByText(t.problems.empty)).toHaveCount(0)
  }
  mode('empty')
  await page.goto('/en/admin')
  await expect(card(page)).toContainText(t.problems.empty)
}
export async function summaryMetricsJourney(page: Page, mode: Mode, metricsOrigin: string) {
  mode('many')
  await page.goto('/en/admin')
  await expect(card(page).getByRole('heading', { level: 3 })).toHaveCount(5)
  await card(page).getByText(t.problems.more.replace('{count}', '2')).focus()
  await page.keyboard.press('Enter')
  await expect(card(page).getByRole('heading', { level: 3 })).toHaveCount(7)
  const metricsLink = card(page).getByRole('link', { name: t.problems.metrics }).first()
  const supplied = new URL((await metricsLink.getAttribute('href'))!)
  expect(supplied.searchParams.get('from')).toBe(
    String(Date.parse('2026-10-25T12:00:00Z') - 900000)
  )
  const popup = page.waitForEvent('popup')
  await card(page).getByRole('link', { name: t.problems.metrics }).first().click()
  const chart = await popup
  await expect(
    chart.getByText('This fixture proves time-range navigation only.', { exact: false })
  ).toBeVisible({ timeout: 45000 })
  const url = new URL(chart.url())
  expect(url.origin).toBe(metricsOrigin)
  const millis = (value: string | null) =>
    /^\d+$/.test(value ?? '') ? Number(value) : Date.parse(value ?? '')
  expect(millis(url.searchParams.get('from'))).toBe(Date.parse('2026-10-25T11:45:00Z'))
  expect(millis(url.searchParams.get('to'))).toBe(Date.parse('2026-10-25T12:15:00Z'))
  await expect(
    chart.getByText('2026-10-25 11:45:00 to 2026-10-25 12:15:00', { exact: false })
  ).toBeVisible()
  await chart.close()
  const href = await card(page)
    .getByRole('link', { name: t.problems.openJob, exact: true })
    .first()
    .getAttribute('href')
  const id = new URL(href!, 'http://stand').searchParams.get('focus')!
  await card(page).getByRole('link', { name: t.problems.openJob, exact: true }).first().click()
  await expect(page.locator(`[data-console-source="scheduled:${id}"]:visible`)).toBeFocused()
  await page.goBack()
  await expect(card(page)).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoAxeViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.goto('/ru/admin')
  await expect(
    page.getByRole('heading', { name: secondary.problems.title, exact: true })
  ).toBeVisible()
  await expectNoAxeViolations(page)
  await page.goto('/ru/admin/scheduled-jobs?focus=not-in-current-list')
  await expect(
    page.getByRole('status').filter({ hasText: secondary.problems.focusMissing })
  ).toBeVisible()
  await page.goto('/ru/admin/integrations?focus=email')
  await expect(page.locator('[data-console-source="integration:email"]:visible')).toBeFocused()
  await page.goto('/ru/admin/background-work?focus=default')
  await expect(page.locator('[data-console-source="queue:default"]:visible')).toBeFocused()
  mode('pass')
}
