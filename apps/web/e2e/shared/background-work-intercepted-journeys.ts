import { expect, type Page } from '@playwright/test'

import { expectNoAxeViolations } from './axe'
import { QUEUES_ROUTE, row } from './background-work-journey'

/** Intercepted BFF answers prove the honest degraded states without stopping the stack's Redis. */
export async function backgroundWorkDegradedJourney(page: Page, url: string): Promise<void> {
  const unavailable = {
    checkedAt: new Date().toISOString(),
    queues: ['email', 'default', 'notifications', 'ai-runs'].map((name) => ({
      name,
      kind: name === 'email' ? 'work' : name === 'default' ? 'extension' : 'wake',
      status: 'unavailable',
    })),
  }
  let calls = 0
  await page.route(QUEUES_ROUTE, async (route) => {
    calls++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(unavailable),
    })
  })
  await page.clock.install()
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Background work' })).toBeVisible()
  await page.clock.runFor(31_000)
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByRole('status')).toContainText('Unavailable does not mean empty')
  // Backoff: the next automatic read is not at +30 s but at +60 s after the first degraded result.
  await page.clock.runFor(31_000)
  await expect.poll(() => calls).toBe(2)
  await page.clock.runFor(40_000)
  expect(calls).toBe(2)
  await page.clock.runFor(30_000)
  await expect.poll(() => calls).toBe(3)
  await expect(row(page, /Email/)).toContainText('Unavailable')
  await expect(row(page, /Email/).getByRole('cell').nth(2)).toHaveText('—')
  await expectNoAxeViolations(page)
}

/**
 * A short `Retry-After` frees the manual Refresh when it ends, while the longer automatic backoff
 * still holds the next automatic read back (real hook, real page; the 429 is an intercepted answer).
 */
export async function backgroundWorkRetryAfterJourney(page: Page, url: string): Promise<void> {
  let calls = 0
  await page.route(QUEUES_ROUTE, async (route) => {
    calls++
    if (calls > 1) return route.continue()
    await route.fulfill({
      status: 429,
      headers: { 'retry-after': '2' },
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 429, message: 'Too many requests' }),
    })
  })
  await page.clock.install()
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'Background work' })).toBeVisible()
  await page.clock.runFor(31_000)
  await expect.poll(() => calls).toBe(1)
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true })
  await expect(refresh).toBeDisabled()
  await expect(page.getByText(/Available in \d+ seconds?/)).toBeVisible()
  await page.clock.runFor(2_500)
  await expect(refresh).toBeEnabled()
  expect(calls).toBe(1) // the 30 s automatic backoff has not ended
  await refresh.click()
  await expect.poll(() => calls).toBe(2)
}
