import { expect, type Page } from '@playwright/test'

import {
  addDefaultQueueJob,
  addFailedDefaultQueueJob,
  BOARD_CANARY,
  clearDefaultQueue,
  seedDefaultQueue,
} from '../support/queue-fixture'

import { expectNoAxeViolations } from './axe'

export const QUEUES_ROUTE = /\/api\/(?:console\/)?background-work\/queues$/
export const row = (page: Page, name: string | RegExp) =>
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

    // Read-only: no control can change a queue. The board is reached only through its own Console
    // route; the API's own mount (`/admin/queues`) is never linked.
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

const GOOGLE_FONTS = /fonts\.(googleapis|gstatic)\.com/
const KNOWN_FONT_VIOLATION = /^style-src-elem https:\/\/fonts\.googleapis\.com\//
const ACTIONS = /retry|clean|promote|remove|pause|resume|obliterate|add job|delete|empty/i

declare global {
  interface Window {
    __boardCsp?: string[]
  }
}

/**
 * The queue board in a real browser through the Console session: it opens in a new tab with no login
 * and no token in the browser, renders under the public base path in both topologies, shows a
 * permanent read-only mark (also on a bookmark and after a reload), offers no action, hides every
 * payload/failure channel, and keeps to its own narrow CSP — the one known exception being the
 * Google Fonts stylesheet that the unmodified board page links, which the CSP blocks.
 */
export async function queueBoardJourney(
  page: Page,
  { pageUrl, boardPath }: { pageUrl: string; boardPath: string }
): Promise<void> {
  const context = page.context()
  const requests: Array<{ url: string; authorization: boolean }> = []
  const responses: Array<{ url: string; status: number }> = []
  const bodies: string[] = []
  context.on('request', (request) =>
    requests.push({ url: request.url(), authorization: Boolean(request.headers().authorization) })
  )
  context.on('response', async (response) => {
    responses.push({ url: response.url(), status: response.status() })
    if (response.url().includes('/bull-board/') || response.url().includes(boardPath)) {
      bodies.push(await response.text().catch(() => ''))
    }
  })
  await context.addInitScript(() => {
    window.__boardCsp = []
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__boardCsp?.push(`${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  seedDefaultQueue({ waiting: 2, oldestSeconds: 60, paused: false })
  addFailedDefaultQueueJob()
  try {
    await page.goto(pageUrl)
    const note = page
      .getByText('Queue board is view-only')
      .locator('xpath=ancestor::*[@data-slot="alert"]')
    await expect(note).toHaveAttribute('role', 'note')
    const entry = page.getByRole('link', { name: /Open queue board/ })
    await expect(entry).toHaveAttribute('href', boardPath)
    await expect(entry).toHaveAttribute('target', '_blank')
    await expect(entry).toHaveAttribute('rel', 'noopener noreferrer')
    const rowLinks = page.getByRole('table', { name: 'Background queues' }).getByRole('link', {
      name: /Open in queue board/,
    })
    await expect(rowLinks).toHaveCount(3)
    await expect(rowLinks.first()).toHaveAttribute('href', `${boardPath}/queue/email`)
    await expectNoAxeViolations(page)

    // The board opens in a new tab, signed in by the Console session alone.
    const popup = page.waitForEvent('popup')
    await entry.click()
    const board = await popup
    await board.waitForLoadState('domcontentloaded')
    expect(new URL(board.url()).pathname).toBe(boardPath)
    await expect(board.getByText('READ-ONLY').first()).toBeVisible()
    await expect(board.getByText('email').first()).toBeVisible()
    await expect(board.getByRole('button', { name: ACTIONS })).toHaveCount(0)

    // The way back to the Console is the last action of the board's header menu, in the visitor's language.
    const back = board.getByText('Back to Console')
    await board.getByRole('banner').getByRole('listitem').last().getByRole('button').click()
    await expect(back).toBeVisible()
    await expect(board.locator(`a[href="${pageUrl}"]`)).toHaveCount(1)
    await board.keyboard.press('Escape')

    // A queue page, its failed job and the job's detail: nothing hidden leaks, nothing errors.
    await board.getByRole('navigation').getByRole('link', { name: 'default' }).click()
    await expect(board).toHaveURL(new RegExp(`${boardPath}/queue/default`))
    await board.getByText('Failed').first().click()
    await expect(board.getByText('e2e-failed').first()).toBeVisible()
    await board.getByText('e2e-failed').first().click()
    await expect(board.getByText('Failure details are not displayed in this board.')).toBeVisible()
    await board.getByRole('tab', { name: 'Data' }).click()
    await expect(board.getByText('[hidden]').first()).toBeVisible()
    await board.getByRole('tab', { name: 'Logs' }).click()
    await expect(board.getByText('Logs are not displayed in this board.')).toBeVisible()
    await expect(board.locator('body')).not.toContainText(BOARD_CANARY)
    await expect(board.locator('body')).not.toContainText('secret.js')

    // The mark survives a reload, and a bookmark (a direct load of a deep link) works.
    await board.reload()
    await expect(board.getByText('READ-ONLY').first()).toBeVisible()
    await board.goto(`${new URL(board.url()).origin}${boardPath}/queue/email`)
    await expect(board.getByText('READ-ONLY').first()).toBeVisible()
    await expect(board.getByText('email').first()).toBeVisible()

    // Document response, fetched by the page itself (cookies as a browser sends them): the board's own
    // policy and no caching. `Set-Cookie` is never readable by script; the BFF unit tests prove it is
    // stripped, and the cookie checks below prove no backend cookie reached the browser.
    const entryDocument = await board.evaluate(async (path) => {
      const response = await fetch(path, { headers: { accept: 'text/html' } })
      return {
        status: response.status,
        csp: response.headers.get('content-security-policy'),
        cache: response.headers.get('cache-control'),
      }
    }, `${boardPath}/`)
    expect(entryDocument.status).toBe(200)
    expect(entryDocument.csp).toContain("script-src 'self'")
    expect(entryDocument.csp).toContain("frame-ancestors 'none'")
    expect(entryDocument.cache).toBe('private, no-store')

    // Containment: no token in any request, no backend cookie readable, no payload in any body.
    expect(requests.filter((request) => request.authorization)).toEqual([])
    const names = (await context.cookies()).map((cookie) => cookie.name)
    expect(names).not.toContain('refresh_token')
    expect(await board.evaluate(() => document.cookie)).not.toContain('refresh_token')
    expect(bodies.join('\n')).not.toContain(BOARD_CANARY)
    expect(bodies.join('\n')).not.toContain('secret.js')

    // Every data request the board's UI made was answered: no closed route is one the UI depends on.
    const refused = responses.filter(
      (response) => response.url.includes(`${boardPath}/api/`) && response.status >= 400
    )
    expect(refused).toEqual([])

    // CSP: the only violation is the known Google Fonts stylesheet, once per document, and nothing is
    // ever received from a Google font host.
    const violations = (await board.evaluate(() => window.__boardCsp ?? [])) as string[]
    expect(violations.filter((violation) => !KNOWN_FONT_VIOLATION.test(violation))).toEqual([])
    expect(violations.length).toBeLessThanOrEqual(1)
    expect(responses.filter((response) => GOOGLE_FONTS.test(response.url))).toEqual([])
    await board.close()
  } finally {
    clearDefaultQueue()
  }
}
