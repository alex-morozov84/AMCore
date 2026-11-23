import { BULL_BOARD_CONTENT_SECURITY_POLICY, DEFAULT_LOCALE } from '@amcore/shared'
import { expect, type Locator, type Page } from '@playwright/test'

import { probeRefusalEvidence } from '../real-stack/helpers'
import { resetBrowserProbeDomainBudget } from '../support/mfa-domain-fixture.mjs'
import {
  addDefaultQueueJob,
  addFailedDefaultQueueJob,
  BOARD_CANARY,
  clearDefaultQueue,
  seedBoardDiagnostics,
  seedDefaultQueue,
} from '../support/queue-fixture'

import { expectNoAxeViolations } from './axe'
import { messages, translate } from './product-settings'

const workNames = {
  en: { default: 'Default queue', email: 'Email delivery' },
  ru: { default: 'Общая очередь', email: 'Отправка писем' },
}[DEFAULT_LOCALE]

export const QUEUES_ROUTE = /\/api\/(?:console\/)?background-work\/queues$/

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
    await expect(
      page.getByRole('heading', { level: 1, name: messages.console.backgroundWork.title })
    ).toBeVisible()

    // First snapshot: server-rendered, with the paused default queue counted as waiting.
    const queue = page
      .getByRole('table', { name: messages.console.backgroundWork.tableLabel })
      .getByRole('row', { name: workNames.default })
    await expect(queue).toContainText(messages.console.backgroundWork.paused)
    await expect(queue.getByRole('cell').nth(2)).toHaveText('3')
    await expect(queue).toContainText(
      translate('console.backgroundWork.ageAtLeast', {
        age: translate('console.backgroundWork.ageMinutes', { n: 5 }),
      })
    )
    await expect(
      page
        .getByRole('table', { name: messages.console.backgroundWork.tableLabel })
        .getByRole('row', { name: workNames.email })
    ).toContainText(messages.console.backgroundWork.notPaused)
    await expect(
      page.getByText(messages.console.backgroundWork.unavailable, { exact: true })
    ).toHaveCount(0)

    // Live refresh: a new job appears after the automatic period, with no navigation.
    addDefaultQueueJob('e2e-extra')
    const refreshed = page.waitForRequest((request) => QUEUES_ROUTE.test(request.url()))
    await page.clock.runFor(31_000)
    await refreshed
    await expect(queue.getByRole('cell').nth(2)).toHaveText('4')

    // Manual refresh works while auto-refresh is paused, and pausing never touches the queue.
    const auto = page.getByRole('button', { name: messages.console.backgroundWork.autoRefreshOn })
    await expect(auto).toHaveAttribute('aria-pressed', 'true')
    await auto.click()
    await expect(
      page.getByRole('button', { name: messages.console.backgroundWork.autoRefreshOff })
    ).toHaveAttribute('aria-pressed', 'false')
    let automatic = 0
    page.on('request', (request) => QUEUES_ROUTE.test(request.url()) && automatic++)
    await page.clock.runFor(120_000)
    expect(automatic).toBe(0)
    await expect(queue).toContainText(messages.console.backgroundWork.paused)
    const manual = page.waitForRequest((request) => QUEUES_ROUTE.test(request.url()))
    await page.getByRole('button', { name: messages.console.overviewRefresh, exact: true }).click()
    await manual

    // Real command UUIDs must use wall time, not the advanced polling-test clock.
    await page.clock.setSystemTime(Date.now())
    await page.clock.resume()

    // Native commands use captured confirmation/receipts; Board remains view-only.
    const controls = page.getByRole('region', {
      name: messages.console.backgroundWork.control.title,
    })
    const external = controls
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: workNames.default }) })
    await expect(
      external.getByText(messages.console.backgroundWork.control.unsupportedQueue)
    ).toBeVisible()
    await expect(
      external
        .getByRole('button', {
          name: messages.console.backgroundWork.control.actions.pause,
          exact: true,
        })
        .or(
          external.getByRole('button', {
            name: messages.console.backgroundWork.control.actions.resume,
            exact: true,
          })
        )
    ).toHaveCount(0)
    const work = controls
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: workNames.email }) })
    await expect(
      work.getByRole('button', {
        name: messages.console.backgroundWork.control.actions.pause,
        exact: true,
      })
    ).toBeEnabled()
    await expect(
      work.getByRole('button', {
        name: messages.console.backgroundWork.control.actions.resume,
        exact: true,
      })
    ).toHaveCount(0)
    await work
      .getByRole('button', {
        name: messages.console.backgroundWork.control.actions.pause,
        exact: true,
      })
      .click()
    const confirmation = page.getByRole('dialog', {
      name: translate('console.backgroundWork.control.confirmTitle', {
        operation: messages.console.backgroundWork.control.actions.pause,
        work: workNames.email,
      }),
    })
    await confirmation
      .getByText(messages.console.backgroundWork.control.technicalDetails, { exact: true })
      .click()
    await expect(confirmation).toContainText(
      translate('console.backgroundWork.control.capturedRevision', { revision: '' })
    )
    await expectNoAxeViolations(page)
    await confirmation.getByRole('button', { name: messages.common.cancel, exact: true }).click()
    await expect(
      work.getByRole('button', {
        name: messages.console.backgroundWork.control.actions.pause,
        exact: true,
      })
    ).toBeEnabled()
    const apply = async (button: Locator, dialog: Locator, opposite: Locator, notice: Locator) => {
      await button.click()
      await dialog
        .getByLabel(messages.console.backgroundWork.control.reason)
        .fill('Browser control conformance')
      await dialog
        .getByRole('button', { name: messages.console.backgroundWork.control.confirm })
        .click()
      await expect(dialog).toBeHidden()
      await expect(notice).toBeVisible()
      await expect(opposite).toBeEnabled()
    }
    await apply(
      work.getByRole('button', {
        name: messages.console.backgroundWork.control.actions.pause,
        exact: true,
      }),
      page.getByRole('dialog', {
        name: translate('console.backgroundWork.control.confirmTitle', {
          operation: messages.console.backgroundWork.control.actions.pause,
          work: workNames.email,
        }),
      }),
      work.getByRole('button', {
        name: messages.console.backgroundWork.control.actions.resume,
        exact: true,
      }),
      page.getByText(messages.console.backgroundWork.control.success.pause, { exact: true })
    )
    await apply(
      work.getByRole('button', {
        name: messages.console.backgroundWork.control.actions.resume,
        exact: true,
      }),
      page.getByRole('dialog', {
        name: translate('console.backgroundWork.control.confirmTitle', {
          operation: messages.console.backgroundWork.control.actions.resume,
          work: workNames.email,
        }),
      }),
      work.getByRole('button', {
        name: messages.console.backgroundWork.control.actions.pause,
        exact: true,
      }),
      page.getByText(messages.console.backgroundWork.control.success.resume, { exact: true })
    )
    await expect(page.locator('a[href*="/admin/queues"]')).toHaveCount(0)

    // The browser never holds a backend token.
    expect(withAuthHeader).toEqual([])

    await expectNoAxeViolations(page)

    // Narrow screens show cards, not a squeezed table.
    await page.setViewportSize({ width: 375, height: 800 })
    await expect(
      page.getByRole('table', { name: messages.console.backgroundWork.tableLabel })
    ).toBeHidden()
    await expect(
      page.getByRole('list', { name: messages.console.backgroundWork.tableLabel })
    ).toBeVisible()
    // The page's own content fits the viewport (the Console header is shell-owned, outside this page).
    const box = await page
      .getByRole('list', { name: messages.console.backgroundWork.tableLabel })
      .boundingBox()
    expect(box).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375)
    await expectNoAxeViolations(page)
  } finally {
    clearDefaultQueue()
  }
}

const GOOGLE_FONTS = /fonts\.(googleapis|gstatic)\.com/
/** The one stylesheet the unmodified board page links; the board's CSP blocks it by `style-src-elem`. */
const KNOWN_FONT_DIRECTIVE = 'style-src-elem'
const boardCopy = {
  en: {
    readOnly: 'READ-ONLY',
    back: 'Back to Console',
    info: 'Queue info',
    hidden: 'Not displayed',
    failed: 'Failed',
    failureHidden: 'Failure details are not displayed in this board.',
    progress: 'Progress',
    data: 'Data',
    logsHidden: 'Logs are not displayed in this board.',
    actions: /retry|clean|promote|remove|pause|resume|obliterate|add job|delete|empty/i,
  },
  ru: {
    readOnly: 'ТОЛЬКО ПРОСМОТР',
    back: 'Назад в консоль',
    info: 'Сведения об очереди',
    hidden: 'Не отображается',
    failed: 'Неудачные',
    failureHidden: 'Сведения об ошибке в этой панели не отображаются.',
    progress: 'Прогресс',
    data: 'Данные',
    logsHidden: 'Журналы в этой панели не отображаются.',
    actions: /повторить|очистить|переместить|приостановить|возобновить|добавить задачу|удалить/i,
  },
}[DEFAULT_LOCALE]

export const queueBoardReadOnlyLabel = boardCopy.readOnly

interface CspViolation {
  documentUri: string
  directive: string
  blockedUri: string
}

declare global {
  interface Window {
    __reportCsp?: (violation: CspViolation) => void
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
  const documents: Array<{ url: string; headers: Record<string, string> }> = []
  const violations: CspViolation[] = []
  context.on('request', (request) =>
    requests.push({ url: request.url(), authorization: Boolean(request.headers().authorization) })
  )
  context.on('response', async (response) => {
    responses.push({ url: response.url(), status: response.status() })
    if (response.request().resourceType() === 'document' && response.url().includes(boardPath)) {
      documents.push({ url: response.url(), headers: response.headers() })
    }
    if (response.url().includes('/bull-board/') || response.url().includes(boardPath)) {
      bodies.push(await response.text().catch(() => ''))
    }
  })
  // Reported from every document as it happens: a navigation or reload cannot lose an earlier one.
  await context.exposeBinding('__reportCsp', (_source, violation: CspViolation) => {
    violations.push(violation)
  })
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__reportCsp?.({
        documentUri: event.documentURI,
        directive: event.violatedDirective,
        blockedUri: event.blockedURI,
      })
    })
  })
  seedDefaultQueue({ waiting: 2, oldestSeconds: 60, paused: false })
  addFailedDefaultQueueJob()
  seedBoardDiagnostics()
  try {
    await page.goto(pageUrl)
    await expect(page.getByText(messages.console.backgroundWork.boardPointer)).toBeVisible()
    await expect(page.getByLabel(messages.console.backgroundWork.board.noteBody)).toBeVisible()
    const entry = page.getByRole('link', { name: messages.console.backgroundWork.board.openLink })
    await expect(entry).toHaveAttribute('href', boardPath)
    await expect(entry).toHaveAttribute('target', '_blank')
    await expect(entry).toHaveAttribute('rel', 'noopener noreferrer')
    const rowLinks = page
      .getByRole('table', { name: messages.console.backgroundWork.tableLabel })
      .getByRole('link', {
        name: messages.console.backgroundWork.board.rowLink,
      })
    await expect(rowLinks).toHaveCount(4)
    await expect(rowLinks.first()).toHaveAttribute('href', `${boardPath}/queue/email`)
    await expectNoAxeViolations(page)

    // The board opens in a new tab, signed in by the Console session alone.
    const popup = page.waitForEvent('popup')
    await entry.click()
    const board = await popup
    await board.waitForLoadState('domcontentloaded')
    expect(new URL(board.url()).pathname).toBe(boardPath)
    await expect(board.getByText(boardCopy.readOnly).first()).toBeVisible()
    await expect(board.getByText('email').first()).toBeVisible()
    await expect(board.getByRole('button', { name: boardCopy.actions })).toHaveCount(0)

    // The way back to the Console is the last action of the board's header menu, in the visitor's language.
    const back = board.getByText(boardCopy.back)
    await board.getByRole('banner').getByRole('listitem').last().getByRole('button').click()
    await expect(back).toBeVisible()
    await expect(board.locator(`a[href="${pageUrl}"]`)).toHaveCount(1)
    await board.keyboard.press('Escape')

    // A queue page, its failed job and the job's detail: nothing hidden leaks, nothing errors.
    await board.getByRole('navigation').getByRole('link', { name: 'default' }).click()
    await expect(board).toHaveURL(new RegExp(`${boardPath}/queue/default`))
    await board.getByRole('button', { name: boardCopy.info }).click()
    await expect(board.getByText(boardCopy.hidden, { exact: true }).first()).toBeVisible()
    await board.keyboard.press('Escape')
    await expect(board.locator('[class*="badgeWrap-O3UZRS"]')).toHaveCount(0)
    await expect(board.locator('a[href*="job-schedulers"]')).toHaveCount(0)
    await board.getByText(boardCopy.failed).first().click()
    await expect(board.getByText('e2e-failed').first()).toBeVisible()
    await board.getByText('e2e-failed').first().click()
    await expect(board.getByText(boardCopy.failureHidden)).toBeVisible()
    await board.getByRole('tab', { name: boardCopy.progress, exact: true }).click()
    await expect(
      board.getByRole('tabpanel', { name: boardCopy.progress, exact: true })
    ).toContainText(boardCopy.hidden)
    await board.getByRole('tab', { name: boardCopy.data }).click()
    await expect(board.getByText('[hidden]').first()).toBeVisible()
    await board.getByRole('tab', { name: messages.console.externalToolsLogs }).click()
    await expect(board.getByText(boardCopy.logsHidden)).toBeVisible()
    await expect(board.locator('[class*="jobFlowCard-"]')).toHaveCount(0)
    await expect(board.locator('body')).not.toContainText(BOARD_CANARY)
    await expect(board.locator('body')).not.toContainText('secret.js')

    // Independent reload/bookmark correctness cases start with idle source budgets.
    // Session, generation and the board's state are unchanged; this is not a throughput test.
    resetBrowserProbeDomainBudget()
    await board.reload()
    await expect(board.getByText(boardCopy.readOnly).first()).toBeVisible()
    resetBrowserProbeDomainBudget()
    await board.goto(`${new URL(board.url()).origin}${boardPath}/queue/email`)
    await expect(board.getByText(boardCopy.readOnly).first()).toBeVisible()
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

    // Every board document the browser loaded (the popup, the reload, the bookmark) carried exactly one
    // Content-Security-Policy, the board's own, and the same fixed security headers.
    expect(documents.length).toBeGreaterThanOrEqual(3)
    for (const document of documents) {
      expect(document.headers['content-security-policy']).toBe(BULL_BOARD_CONTENT_SECURITY_POLICY)
      expect(document.headers['referrer-policy']).toBe('no-referrer')
      expect(document.headers['x-content-type-options']).toBe('nosniff')
      expect(document.headers['cache-control']).toBe('private, no-store')
      expect(document.headers['set-cookie']).toBeUndefined()
    }

    const html = await board.evaluate(async (path) => (await fetch(path)).text(), `${boardPath}/`)
    const relativeScript = /(?:src|href)="([^"]*static[^"]+\.js)"/.exec(html)?.[1]
    expect(relativeScript).toBeDefined()
    const assetUrl = relativeScript!.startsWith('/')
      ? relativeScript!
      : `${boardPath}/${relativeScript!}`
    // Static files revalidate; a file that does not exist is a plain 404 whose body is the Console's own
    // standard error with a fixed message (the bridge never relays the API's body, so no framework text
    // such as "Cannot GET" and no stack).
    // Both the API and the bridge's independently created error forbid storing the failed answer.
    const files = await board.evaluate(
      async ({ path, script }) => {
        const found = await fetch(script)
        const missing = await fetch(`${path}/static/js/does-not-exist.js`)
        const head = await fetch(`${path}/static/js/does-not-exist.js`, { method: 'HEAD' })
        return {
          foundCache: found.headers.get('cache-control'),
          foundStatus: found.status,
          missingStatus: missing.status,
          missingBody: await missing.text(),
          missingCache: missing.headers.get('cache-control'),
          missingCsp: missing.headers.get('content-security-policy'),
          missingCorp: missing.headers.get('cross-origin-resource-policy'),
          headStatus: head.status,
          headCache: head.headers.get('cache-control'),
          headCsp: head.headers.get('content-security-policy'),
          headBody: await head.text(),
        }
      },
      { path: boardPath, script: assetUrl }
    )
    expect(files.foundStatus).toBe(200)
    expect(files.foundCache).toBe('private, no-cache')
    expect(files.missingStatus).toBe(404)
    expect(files.missingCache).toBe('private, no-store')
    expect(files.missingCsp).toBe(BULL_BOARD_CONTENT_SECURITY_POLICY)
    expect(files.missingCorp).toBe('same-origin')
    expect(files.headStatus).toBe(404)
    expect(files.headCache).toBe('private, no-store')
    expect(files.headCsp).toBe(BULL_BOARD_CONTENT_SECURITY_POLICY)
    expect(files.headBody).toBe('')
    expect(JSON.parse(files.missingBody)).toMatchObject({ message: 'Queue board unavailable' })
    expect(files.missingBody).not.toContain('Cannot GET')
    expect(files.missingBody).not.toContain('stack')

    // CSP: in EVERY document the only violation is the known Google Fonts stylesheet, by its exact URL
    // and directive, exactly once; and nothing is ever received from a Google font host.
    const stylesheet = /href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/.exec(html)?.[1]
    expect(stylesheet).toBeDefined()
    expect(violations.length).toBeGreaterThanOrEqual(3)
    for (const violation of violations) {
      expect(violation.directive).toBe(KNOWN_FONT_DIRECTIVE)
      expect(violation.blockedUri).toBe(stylesheet)
    }
    // One violation per loaded document instance: for each URL, as many violations as document loads.
    const count = (values: string[]) =>
      values.reduce(
        (acc, value) => acc.set(value, (acc.get(value) ?? 0) + 1),
        new Map<string, number>()
      )
    expect(count(violations.map((violation) => violation.documentUri))).toEqual(
      count(documents.map((document) => document.url))
    )
    expect(responses.filter((response) => GOOGLE_FONTS.test(response.url))).toEqual([])
    await board.close()
  } catch (error) {
    console.error('Queue board primary-status evidence', await probeRefusalEvidence())
    throw error
  } finally {
    clearDefaultQueue()
  }
}
