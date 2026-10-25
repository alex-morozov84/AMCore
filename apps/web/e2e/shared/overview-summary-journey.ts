import { expect, type Page } from '@playwright/test'

import { expectNoAxeViolations } from './axe'
type Mode = (value: string) => unknown
const card = (page: Page) => page.locator('[aria-labelledby="overview-attention-title"]')
export async function summaryFaultJourney(page: Page, mode: Mode, assertReads: () => void) {
  mode('empty')
  await page.goto('/en/admin')
  await expect(card(page)).toContainText('No problems found in the received data.')
  assertReads()
  mode('queues500')
  await page.goto('/en/admin')
  await expect(card(page)).toContainText('Could not verify')
  await expect(card(page)).toContainText('Could not read this section')
  await expect(page.getByRole('heading', { name: 'API disk space', exact: true })).toBeVisible()
  mode('all500')
  await page.goto('/en/admin')
  await expect(card(page)).toContainText('Could not read the data for this summary.')
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  mode('retry')
  await page.goto('/en/admin')
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled()
  await expect(page.getByText(/Refresh available in \d+ seconds?/)).toBeVisible()
  mode('empty')
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled({
    timeout: 5000,
  })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(card(page)).toContainText('No problems found in the received data.')
  mode('slow')
  const refreshed = page.waitForResponse(
    (r) => r.request().headers()['rsc'] === '1' && r.status() === 200
  )
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(card(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refreshing…', exact: true })).toBeDisabled()
  await refreshed
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  for (const fault of ['integrations401', 'malformed']) {
    mode(fault)
    await page.goto('/en/admin')
    await expect(card(page)).toHaveCount(0)
    await expect(page.getByText('No problems found in the received data.')).toHaveCount(0)
  }
  mode('empty')
  await page.goto('/en/admin')
  await expect(card(page)).toContainText('No problems found in the received data.')
}
export async function summaryMetricsJourney(page: Page, mode: Mode, metricsOrigin: string) {
  mode('many')
  await page.goto('/en/admin')
  await expect(card(page).getByRole('heading', { level: 3 })).toHaveCount(5)
  await card(page).getByText('Show 2 more').focus()
  await page.keyboard.press('Enter')
  await expect(card(page).getByRole('heading', { level: 3 })).toHaveCount(7)
  const metricsLink = card(page)
    .getByRole('link', { name: /Metrics around this time/ })
    .first()
  const supplied = new URL((await metricsLink.getAttribute('href'))!)
  expect(supplied.searchParams.get('from')).toBe(
    String(Date.parse('2026-10-25T12:00:00Z') - 900000)
  )
  const popup = page.waitForEvent('popup')
  await card(page)
    .getByRole('link', { name: /Metrics around this time/ })
    .first()
    .click()
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
    .getByRole('link', { name: 'Open job', exact: true })
    .first()
    .getAttribute('href')
  const id = new URL(href!, 'http://stand').searchParams.get('focus')!
  await card(page).getByRole('link', { name: 'Open job', exact: true }).first().click()
  await expect(page.locator(`[data-console-source="scheduled:${id}"]:visible`)).toBeFocused()
  await page.goBack()
  await expect(card(page)).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoAxeViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.goto('/ru/admin')
  await expect(page.getByRole('heading', { name: 'Требует внимания', exact: true })).toBeVisible()
  await expectNoAxeViolations(page)
  await page.goto('/ru/admin/scheduled-jobs?focus=not-in-current-list')
  await expect(
    page.getByRole('status').filter({ hasText: 'Запись больше не показана' })
  ).toBeVisible()
  await page.goto('/ru/admin/integrations?focus=email')
  await expect(page.locator('[data-console-source="integration:email"]:visible')).toBeFocused()
  await page.goto('/ru/admin/background-work?focus=default')
  await expect(page.locator('[data-console-source="queue:default"]:visible')).toBeFocused()
  mode('pass')
}
