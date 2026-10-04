import { expect, type Page } from '@playwright/test'

import { expectNoAxeViolations } from './axe'
import { QUEUES_ROUTE, row } from './background-work-journey'

/** Intercepted BFF answers prove the honest degraded states without stopping the stack's Redis. */
export async function backgroundWorkDegradedJourney(page: Page, url: string): Promise<void> {
  const unavailable = {
    checkedAt: new Date().toISOString(),
    board: { state: 'available' },
    queues: ['email', 'default', 'notifications', 'ai-runs'].map((name) => ({
      name,
      kind: name === 'email' ? 'work' : name === 'default' ? 'extension' : 'wake',
      inBoard: true,
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

/**
 * The queue board entry follows what the live summary confirms. The first snapshot is the real one
 * (the board is mounted on the stand); the polls are real answers with only `board.state` replaced,
 * which is what a restart of the API with and without `ENABLE_BULL_BOARD` looks like to the page.
 */
export async function backgroundWorkBoardStatesJourney(page: Page, url: string): Promise<void> {
  let board: 'available' | 'disabled' = 'disabled'
  await page.route(QUEUES_ROUTE, async (route) => {
    const response = await route.fetch()
    const json = (await response.json()) as Record<string, unknown>
    await route.fulfill({ response, json: { ...json, board: { state: board } } })
  })
  await page.clock.install()
  // A bookmark of a failed open: the marker is a one-shot, the board is available at load.
  await page.goto(`${url}?board=unavailable`)
  await expect(page.getByRole('heading', { level: 1, name: 'Background work' })).toBeVisible()
  const open = page.getByRole('link', { name: /Open queue board/ })
  const rowLinks = page.getByRole('table', { name: 'Background queues' }).getByRole('link', {
    name: /Open in queue board/,
  })
  await expect(
    page.getByRole('status').filter({ hasText: 'Could not open the queue board' })
  ).toBeVisible()
  await expect(open).toBeVisible()
  await expect(rowLinks).toHaveCount(4)
  await expect(page).not.toHaveURL(/board=/)
  await expect(page.getByText('ENABLE_BULL_BOARD')).toHaveCount(0)

  // The API restarted without the flag: the fresh confirmation replaces the stale notice.
  await page.clock.runFor(31_000)
  await expect(page.getByText('Queue board is not enabled')).toBeVisible()
  await expect(page.getByText('Could not open the queue board')).toHaveCount(0)
  await expect(open).toHaveCount(0)
  await expect(rowLinks).toHaveCount(0)
  const disabled = page
    .getByText('Queue board is not enabled')
    .locator('xpath=ancestor::*[@data-slot="alert"]')
  await expect(disabled).toContainText('ENABLE_BULL_BOARD=true')
  await expect(disabled).toContainText('restart the API')
  await expect(disabled).toContainText('it stays view-only')
  await expect(disabled.getByRole('link', { name: /Queue board guide/ })).toHaveAttribute(
    'target',
    '_blank'
  )
  await expectNoAxeViolations(page)

  // And again with the flag: the entry returns, and the old failed-open notice does not.
  board = 'available'
  await page.clock.runFor(31_000)
  await expect(open).toBeVisible()
  await expect(rowLinks).toHaveCount(4)
  await expect(page.getByText('Queue board is not enabled')).toHaveCount(0)
  await expect(page.getByText('Could not open the queue board')).toHaveCount(0)
  await expect(page.getByText('ENABLE_BULL_BOARD')).toHaveCount(0)

  // The page says in its description that the board is view-only, and the help icon beside the
  // button carries the full explanation; on a phone the actions wrap instead of overflowing.
  await expect(page.getByText('To look at the jobs themselves, open the queue board')).toBeVisible()
  await expect(page.getByLabel(/Retrying or deleting jobs and managing queues/)).toBeVisible()
  await page.setViewportSize({ width: 320, height: 800 })
  const box = await open.boundingBox()
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320)
  await expectNoAxeViolations(page)
}
