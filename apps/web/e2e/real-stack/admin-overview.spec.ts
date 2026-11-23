import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ADMIN_CONSOLE_SETTINGS,
  DEFAULT_LOCALE,
  localePathPrefix,
  SERVED_LOCALES,
} from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { requireDisabledConsole, requirePathConsole } from '../shared/console-applicability'
import { summaryFaultJourney, summaryMetricsJourney } from '../shared/overview-summary-journey'
import { isProductHome, messagesForLocale } from '../shared/product-settings'
import { activeTarget, guardedExec, guardedSql } from '../support/managed-target.mjs'

import { setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

const t = JSON.parse(
  readFileSync(join(activeTarget().snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
).console
const overviewPath = `${localePathPrefix(DEFAULT_LOCALE)}/${ADMIN_CONSOLE_SETTINGS.alias}`

const telegramBlockedTitle = {
  en: 'Telegram destination blocked',
  ru: 'Получатель Telegram заблокирован',
}[DEFAULT_LOCALE]

/**
 * Path mode reuses the ordinary product session for the console (no
 * separate console login) - mirrors `console-real-stack/overview.spec.ts`'s
 * host-mode coverage of the same panel. See that file's `SystemRolesGuard`
 * note on why SUPER_ADMIN tests must re-authenticate after promotion.
 */
test.describe(() => {
  requirePathConsole()
  test('path-mode Overview panel renders real readiness, version and process role via the reused product session', async ({
    page,
  }) => {
    const email = uniqueEmail('admin-overview')
    await registerViaUi(page, email)
    await expect(page).toHaveURL(isProductHome)
    setSystemRole(email, 'SUPER_ADMIN')
    await page.context().clearCookies()
    await loginViaUi(page, email)
    await expect(page).toHaveURL(isProductHome)

    const requestsWithAuthHeader: string[] = []
    page.on('request', (request) => {
      if (request.headers().authorization) requestsWithAuthHeader.push(request.url())
    })

    await page.goto(overviewPath)
    // A fresh docker-compose stack is healthy - assert the ready state, not
    // the not-ready one, and confirm it never says the console is unhealthy.
    await expect(page.getByText(t.overviewNotReadyTitle)).not.toBeVisible()
    await expect(page.getByText(t.overviewDependencyLabelDatabase, { exact: true })).toBeVisible()
    await expect(page.getByText(t.overviewDependencyLabelRedis)).toBeVisible()
    await expect(page.getByText(t.overviewReadyTitle, { exact: true })).toBeVisible()
    await expect(page.getByText(t.overviewFilesHealthy, { exact: true })).toBeVisible()
    await page.getByText(t.overviewTechnicalDetails, { exact: true }).click()
    await expect(page.getByText(t.overviewVersionLabel)).toBeVisible()
    await expect(page.getByText(t.overviewProcessRoleLabel)).not.toBeVisible()

    for (const name of [
      t.overviewWebTitle,
      t.overviewPoolTitle,
      t.overviewMemoryTitle,
      t.overviewDiskTitle,
    ]) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
    // The stack sets no external tool address, so the card says so and still offers the guide.
    await expect(
      page.getByRole('heading', { name: t.externalToolsTitle, exact: true })
    ).toBeVisible()
    await expect(page.getByText(t.externalToolsNone)).toBeVisible()
    await expect(page.getByRole('link', { name: t.externalToolsRecovery })).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    )
    await expect(page.getByRole('heading', { name: t.problems.title, exact: true })).toBeVisible()
    const observed = page.locator('#overview-api-checks time').first()
    const before = await observed.getAttribute('datetime')
    const refresh = page.getByRole('button', { name: t.overviewRefresh, exact: true })
    await refresh.focus()
    await expect(refresh).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(observed).not.toHaveAttribute('datetime', before!)
    await expect(refresh).toBeEnabled()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(
      page.getByRole('heading', { name: t.overviewDiskTitle, exact: true })
    ).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await expectNoAxeViolations(page)

    const html = await page.content()
    expect(html).not.toContain('Bearer ')
    expect(requestsWithAuthHeader).toHaveLength(0)
  })

  test('path-mode Overview panel denies a demoted session with a live re-check', async ({
    page,
  }) => {
    const email = uniqueEmail('admin-overview-denied')
    await registerViaUi(page, email)
    setSystemRole(email, 'SUPER_ADMIN')
    await page.context().clearCookies()
    await loginViaUi(page, email)
    await expect(page).toHaveURL(isProductHome)

    await page.goto(overviewPath)
    await expect(page.getByRole('heading', { name: t.title })).toBeVisible()

    setSystemRole(email, 'USER')
    const response = await page.goto(overviewPath)
    expect(response?.status()).toBe(404)
  })

  test('path-mode console locale switcher preserves the current page and its query parameters', async ({
    page,
  }) => {
    const email = uniqueEmail('admin-overview-locale')
    await registerViaUi(page, email)
    setSystemRole(email, 'SUPER_ADMIN')
    await page.context().clearCookies()
    await loginViaUi(page, email)
    await expect(page).toHaveURL(isProductHome)

    await page.goto(`${overviewPath}/organizations?page=2`)
    const second = SERVED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE)
    if (!second) {
      await expect(page.getByRole('combobox')).toHaveCount(0)
      await expect(page).toHaveURL(
        `${new URL(page.url()).origin}${overviewPath}/organizations?page=2`
      )
      await expect(page.locator('html')).toHaveAttribute('lang', DEFAULT_LOCALE)
      return
    }
    await page
      .getByRole('combobox', { name: messagesForLocale(DEFAULT_LOCALE).locale.label, exact: true })
      .selectOption(second)
    await expect(page).toHaveURL(
      `${new URL(page.url()).origin}${localePathPrefix(second)}/${ADMIN_CONSOLE_SETTINGS.alias}/organizations?page=2`
    )
    const secondMessages = JSON.parse(
      readFileSync(join(activeTarget().snapshot, `apps/web/messages/${second}.json`), 'utf8')
    )
    await expect(
      page.getByRole('heading', { name: secondMessages.console.organizations, exact: true })
    ).toBeVisible()
  })

  test.describe('summary fixture', () => {
    test.skip(activeTarget().fixtureProfile !== 'console-summary', 'requires:console-summary')
    test.describe.configure({ mode: 'default' })
    const mode = (value: string) => {
      guardedExec('redis', 'redis-cli', 'DEL', 'amcore:console-summary-fixture:reads')
      return guardedExec('redis', 'redis-cli', 'SET', 'amcore:console-summary-fixture', value)
    }
    async function operator(page: Parameters<typeof registerViaUi>[0]) {
      const email = uniqueEmail('summary')
      await registerViaUi(page, email)
      setSystemRole(email, 'SUPER_ADMIN')
      await page.context().clearCookies()
      await loginViaUi(page, email)
      await expect(page).toHaveURL(isProductHome)
      return email
    }
    test('stored delivery failure opens the existing failed list; unresolved outcomes open the summary', async ({
      page,
    }) => {
      const email = await operator(page)
      mode('pass')
      const id = 'summary-failed-delivery'
      guardedSql(
        `
      INSERT INTO notifications.notifications (id,"recipientUserId",type,category,"schemaVersion",payload,"idempotencyKey","idempotencyFingerprint","occurredAt","createdAt")
      SELECT :'parent',id,'account.password_changed','security',1,jsonb_build_object('changedAt',clock_timestamp()),:'parent',:'parent',clock_timestamp(),clock_timestamp() FROM core.users WHERE "emailCanonical"=:'email';
      INSERT INTO notifications.notification_deliveries (id,"notificationId",channel,"targetKey",locale,status,"maxAttempts","attemptCount","terminalReasonCode","lastErrorCode","terminalAt","updatedAt")
      VALUES (:'id',:'parent','telegram','111004','en','FAILED',5,1,'permanent_failure','telegram_blocked',clock_timestamp(),clock_timestamp());
    `,
        { id, parent: 'summary-event', email }
      )
      const effects: string[] = []
      page.on('request', (r) => {
        if (r.method() !== 'GET' && /background-work/.test(r.url())) effects.push(r.url())
      })
      await page.goto(overviewPath)
      const row = page
        .locator('[aria-labelledby="overview-attention-title"] li')
        .filter({ hasText: t.problems.notificationFailed.split('{count}')[0] })
      await expect(row).toHaveCount(1)
      await expect(row.getByRole('link', { name: t.problems.guide })).toHaveAttribute(
        'href',
        /background-work.md#notification-deliveries$/
      )
      await row.getByRole('link', { name: t.problems.openErrors, exact: true }).click()
      await expect(page).toHaveURL(/work=notification-deliveries&state=failed/)
      await expect(
        page.locator('[data-console-source="work-errors:notification-deliveries"]')
      ).toBeFocused()
      await expect(page.getByText(id, { exact: true })).toBeVisible()
      await expect(page.getByText(telegramBlockedTitle, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: t.overviewRefresh, exact: true }).click()
      await expect(
        page.locator('[data-console-source="work-errors:notification-deliveries"]')
      ).not.toBeFocused()
      guardedSql(
        `UPDATE notifications.notification_deliveries SET "unresolvedEffectCount"=1 WHERE id=:'id';`,
        { id }
      )
      await page.goto(overviewPath)
      const unresolved = page
        .locator('[aria-labelledby="overview-attention-title"] li')
        .filter({ hasText: t.problems.notificationFailed.split('{count}')[0] })
      await expect(unresolved).toContainText(t.problems.unresolved.split('{count}')[0])
      await unresolved.getByRole('link', { name: t.problems.openWork, exact: true }).click()
      await expect(page).toHaveURL(/work=notification-deliveries$/)
      await expect(
        page.locator('[data-console-source="work:notification-deliveries"]')
      ).toBeFocused()
      await expect(page.getByText(t.problems.unresolvedHelp)).toBeVisible()
      await expect(
        page.locator('[data-console-source="work-errors:notification-deliveries"]')
      ).toHaveCount(0)
      expect(effects).toEqual([])
    })
    test('partial and unavailable source results, manual wait and slow refresh preserve truthful UI', async ({
      page,
    }) => {
      await operator(page)
      await summaryFaultJourney(page, mode, () => {
        const rows = guardedExec(
          'redis',
          'redis-cli',
          'HGETALL',
          'amcore:console-summary-fixture:reads'
        )
          .trim()
          .split('\n')
        expect(rows.filter((_, i) => i % 2 === 0).sort()).toEqual(
          [
            '/api/v1/admin/overview',
            '/api/v1/admin/background-work/queues',
            '/api/v1/admin/background-work/works',
            '/api/v1/admin/background-work/scheduled-jobs',
            '/api/v1/admin/integrations',
          ].sort()
        )
        expect(rows.filter((_, i) => i % 2 === 1)).toEqual(['1', '1', '1', '1', '1'])
      })
    })
    test('large summary, focus, languages, narrow layout and real Grafana time navigation', async ({
      page,
    }) => {
      await operator(page)
      await summaryMetricsJourney(page, mode, activeTarget().origins.metrics!)
    })
  })
})

test.describe(() => {
  requireDisabledConsole()
  test('disabled Console refuses its page and BFF for an authenticated operator', async ({
    page,
  }) => {
    const email = uniqueEmail('console-disabled')
    await registerViaUi(page, email)
    setSystemRole(email, 'SUPER_ADMIN')
    await page.context().clearCookies()
    await loginViaUi(page, email)
    await expect(page).toHaveURL(isProductHome)
    expect((await page.goto(overviewPath))?.status()).toBe(404)
    const response = await page.request.get('/api/console/organization-establishment/session')
    expect(response.status()).toBe(404)
  })
})
