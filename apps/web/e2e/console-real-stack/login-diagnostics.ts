import { expect, type Page } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { messages } from '../shared/product-settings'

/** Same detail-to-Audit journey on path and isolated-host session domains. */
export async function inspectLoginDiagnostics(
  page: Page,
  id: string,
  email: string,
  canary: string
) {
  const list = new URL(page.url())
  list.searchParams.set('search', email)
  list.searchParams.set('sortBy', 'createdAt')
  await page.goto(list.href)
  await expect(page.getByLabel(messages.console.usersSearchLabel)).toHaveValue(email)
  const authHeaders: string[] = []
  page.on('request', (request) => {
    if (request.headers().authorization) authHeaders.push(request.url())
  })
  await page
    .getByRole('row')
    .filter({ hasText: email })
    .getByRole('link', { name: 'Diagnostic target' })
    .click()
  await expect(
    page.getByRole('heading', { name: messages.console.detail.userTitle, exact: true })
  ).toBeVisible()
  const main = page.getByRole('main')
  const facts = main.locator('dl').first()
  await expect(facts).toContainText(messages.console.detail.login.configured)
  await expect(facts).toContainText('Google, GitHub, Apple, Telegram')
  await expect(
    facts.locator('dt').filter({ hasText: messages.console.detail.lastSignIn }).locator('..')
  ).toContainText(messages.console.apiKeys.notApplicable)
  const detail = page.url()
  const html = await page.request.get(detail)
  expect(html.ok()).toBe(true)
  const htmlBody = await html.text()
  expect(htmlBody).not.toContain(canary)
  expect(htmlBody).not.toMatch(/passwordHash|providerAccountId|accessToken|refreshToken/)
  const rscUrl = new URL(detail)
  // With no router variation headers, Next expects an empty cache-busting value.
  rscUrl.searchParams.set('_rsc', '')
  const rsc = await page.request.get(rscUrl.href, { headers: { RSC: '1' }, maxRedirects: 0 })
  expect(rsc.ok()).toBe(true)
  expect(rsc.headers()['content-type']).toContain('text/x-component')
  const rscBody = await rsc.text()
  expect(rscBody).toContain(email)
  expect(rscBody).not.toContain(canary)
  expect(rscBody).not.toMatch(/passwordHash|providerAccountId|accessToken|refreshToken/)
  const confirmations = main.getByRole('link', {
    name: messages.console.detail.login.confirmations,
    exact: true,
  })
  await confirmations.focus()
  await expect(confirmations).toBeFocused()
  const href = await confirmations.getAttribute('href')
  expect(href).toContain('actorType=USER')
  expect(href).toContain(`actorId=${id}`)
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: messages.console.auditTitle, exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('cell', { name: messages.console.audit.actions.auth_step_up_failed }).first()
  ).toBeVisible()
  await expect(
    page
      .getByRole('row', { name: messages.console.audit.actions.auth_step_up_failed })
      .or(page.getByRole('row', { name: messages.console.audit.actions.auth_step_up_succeeded }))
  ).toHaveCount(2)
  await expect(
    page.getByRole('row', { name: messages.console.audit.actions.admin_user_system_role_changed })
  ).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(detail)
  await expect(
    main.getByRole('heading', { name: messages.console.detail.login.securityEvents, exact: true })
  ).toBeVisible()
  await main.getByRole('link', { name: messages.console.detail.login.access, exact: true }).click()
  await expect(
    page.getByRole('heading', { name: messages.console.auditTitle, exact: true })
  ).toBeVisible()
  await expect(
    page
      .getByRole('row', { name: messages.console.audit.actions.admin_user_system_role_changed })
      .or(
        page.getByRole('row', { name: messages.console.audit.actions.admin_user_session_revoked })
      )
      .or(
        page.getByRole('row', { name: messages.console.audit.actions.admin_user_sessions_revoked })
      )
  ).toHaveCount(3)
  await expect(
    page
      .getByRole('row', { name: messages.console.audit.actions.auth_step_up_failed })
      .or(page.getByRole('row', { name: messages.console.audit.actions.auth_step_up_succeeded }))
  ).toHaveCount(0)
  await page.goBack()
  await main.getByRole('link', { name: messages.console.detail.backUsers, exact: true }).click()
  await expect(page).toHaveURL(list.href)
  await expect(page.getByLabel(messages.console.usersSearchLabel)).toHaveValue(email)
  await page
    .getByRole('row')
    .filter({ hasText: email })
    .getByRole('link', { name: 'Diagnostic target' })
    .click()
  await expect(
    main.getByRole('heading', { name: messages.console.detail.login.securityEvents, exact: true })
  ).toBeVisible()
  await expectNoAxeViolations(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 360, height: 800 })
  await expect(
    main.getByRole('link', { name: messages.console.detail.login.access, exact: true })
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
  await expectNoAxeViolations(page)
  expect(authHeaders).toEqual([])
}
