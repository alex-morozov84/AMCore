import { expect, type Page } from '@playwright/test'

import { addDefaultQueueJob, clearDefaultQueue, seedDefaultQueue } from '../support/queue-fixture'

import { expectNoAxeViolations } from './axe'

const QUEUES_ROUTE = /\/api\/(?:console\/)?background-work\/queues$/
const row = (page: Page, name: string | RegExp) =>
  page.getByRole('table', { name: 'Background queues' }).getByRole('row', { name })

/**
 * Shared assertions for both topologies: the first RSC snapshot, live refresh through the fixed
 * BFF GET, token containment, responsive presentation, honest degraded states and accessibility.
 */
export async function backgroundWorkJourney(page: Page, url: string): Promise<void> {
  const withAuthHeader: string[] = []
  page.on('request', (request) => {
    if (request.headers().authorization) withAuthHeader.push(request.url())
  })
  seedDefaultQueue({ waiting: 3, oldestSeconds: 300, paused: true })
  try {
    await page.clock.install()
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1, name: 'Background work' })).toBeVisible()

    // First snapshot: server-rendered, with the paused default queue counted as waiting.
    const queue = row(page, /Default/)
    await expect(queue).toContainText('Paused')
    await expect(queue.getByRole('cell').nth(2)).toHaveText('3')
    await expect(queue).toContainText('At least 5 minutes')
    await expect(row(page, /Email/)).toContainText('Not paused')
    await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(0)

    // Live refresh: a new job appears after the automatic period, with no navigation.
    addDefaultQueueJob('e2e-extra')
    const refreshed = page.waitForRequest((request) => QUEUES_ROUTE.test(request.url()))
    await page.clock.runFor(31_000)
    await refreshed
    await expect(queue.getByRole('cell').nth(2)).toHaveText('4')

    // Manual refresh works while auto-refresh is paused, and pausing never touches the queue.
    const auto = page.getByRole('button', { name: 'Auto-refresh: on' })
    await expect(auto).toHaveAttribute('aria-pressed', 'true')
    await auto.click()
    await expect(page.getByRole('button', { name: 'Auto-refresh: paused' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    let automatic = 0
    page.on('request', (request) => QUEUES_ROUTE.test(request.url()) && automatic++)
    await page.clock.runFor(120_000)
    expect(automatic).toBe(0)
    await expect(queue).toContainText('Paused')
    const manual = page.waitForRequest((request) => QUEUES_ROUTE.test(request.url()))
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await manual

    // Read-only: no control can change a queue, and no board link is offered.
    await expect(
      page.getByRole('button', {
        name: /^(retry|clean|resume|promote|delete|pause queue|obliterate)/i,
      })
    ).toHaveCount(0)
    await expect(page.locator('a[href*="/admin/queues"]')).toHaveCount(0)

    // The browser never holds a backend token.
    expect(withAuthHeader).toEqual([])

    await expectNoAxeViolations(page)

    // Narrow screens show cards, not a squeezed table.
    await page.setViewportSize({ width: 375, height: 800 })
    await expect(page.getByRole('table', { name: 'Background queues' })).toBeHidden()
    await expect(page.getByRole('list', { name: 'Background queues' })).toBeVisible()
    // The page's own content fits the viewport (the Console header is shell-owned, outside this page).
    const box = await page.getByRole('list', { name: 'Background queues' }).boundingBox()
    expect(box).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375)
    await expectNoAxeViolations(page)
  } finally {
    clearDefaultQueue()
  }
}

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
