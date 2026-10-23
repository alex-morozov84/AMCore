import { expect, type Page } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

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
  await expect(page.getByLabel(/search users/i)).toHaveValue(email)
  const authHeaders: string[] = []
  page.on('request', (request) => {
    if (request.headers().authorization) authHeaders.push(request.url())
  })
  await page
    .getByRole('row')
    .filter({ hasText: email })
    .getByRole('link', { name: 'Diagnostic target' })
    .click()
  await expect(page.getByRole('heading', { name: 'User details', exact: true })).toBeVisible()
  const main = page.getByRole('main')
  const facts = main.locator('dl').first()
  await expect(facts).toContainText('Configured')
  await expect(facts).toContainText('Google, GitHub, Apple, Telegram')
  await expect(
    facts
      .locator('dt')
      .filter({ hasText: /^Last sign-in$/ })
      .locator('..')
  ).toContainText('—')
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
  const confirmations = main.getByRole('link', { name: 'Password confirmations', exact: true })
  await confirmations.focus()
  await expect(confirmations).toBeFocused()
  const href = await confirmations.getAttribute('href')
  expect(href).toContain('actorType=USER')
  expect(href).toContain(`actorId=${id}`)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Audit', exact: true })).toBeVisible()
  await expect(
    page.getByRole('cell', { name: /Fresh authentication failed/ }).first()
  ).toBeVisible()
  await expect(
    page.getByRole('row', { name: /Fresh authentication (failed|succeeded)/ })
  ).toHaveCount(2)
  await expect(page.getByRole('row', { name: /User system role changed/ })).toHaveCount(0)
  await page.goBack()
  await expect(page).toHaveURL(detail)
  await expect(
    main.getByRole('heading', { name: 'Recorded security events', exact: true })
  ).toBeVisible()
  await main.getByRole('link', { name: 'Access changes', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Audit', exact: true })).toBeVisible()
  await expect(
    page.getByRole('row', { name: /User system role changed|User sessions? revoked/ })
  ).toHaveCount(3)
  await expect(page.getByRole('row', { name: /Fresh authentication/ })).toHaveCount(0)
  await page.goBack()
  await main.getByRole('link', { name: 'Back to Users', exact: true }).click()
  await expect(page).toHaveURL(list.href)
  await expect(page.getByLabel(/search users/i)).toHaveValue(email)
  await page
    .getByRole('row')
    .filter({ hasText: email })
    .getByRole('link', { name: 'Diagnostic target' })
    .click()
  await expect(
    main.getByRole('heading', { name: 'Recorded security events', exact: true })
  ).toBeVisible()
  await expectNoAxeViolations(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.setViewportSize({ width: 360, height: 800 })
  await expect(main.getByRole('link', { name: 'Access changes', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
  await expectNoAxeViolations(page)
  expect(authHeaders).toEqual([])
}
