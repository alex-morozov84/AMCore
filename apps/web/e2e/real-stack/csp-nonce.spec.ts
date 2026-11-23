import { expect, test } from '@playwright/test'

import { waitForAnimationsToFinish } from '../shared/axe'
import { isProductHome, messages, productPath } from '../shared/product-settings'

import { registerViaUi, uniqueEmail } from './helpers'

/** Check enforcing CSP against the production standalone server, including real navigation. */
test('production build: no CSP violations during normal navigation', async ({ page }) => {
  const violations: string[] = []
  await page.exposeFunction('__reportCspViolation', (detail: string) => violations.push(detail))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      // @ts-expect-error -- exposed by exposeFunction above
      window.__reportCspViolation(`${event.violatedDirective}: ${event.blockedURI}`)
    })
  })

  await page.goto(productPath('/login'))
  await page.waitForLoadState('networkidle')

  expect(violations, `unexpected CSP violations: ${violations.join(', ')}`).toHaveLength(0)
})

test('production build: every inline <script> the server returns carries the CSP nonce', async ({
  request,
}) => {
  const response = await request.get(productPath('/login'))
  const csp =
    response.headers()['content-security-policy-report-only'] ??
    response.headers()['content-security-policy']
  expect(csp).toBeTruthy()

  const nonce = csp!.match(/'nonce-([^']+)'/)?.[1]
  expect(nonce).toBeTruthy()

  const html = await response.text()
  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? []
  expect(scriptTags.length).toBeGreaterThan(0)

  const withoutThisNonce = scriptTags.filter((tag) => !tag.includes(`nonce="${nonce}"`))
  expect(
    withoutThisNonce,
    `bare or mismatched script tags: ${JSON.stringify(withoutThisNonce)}`
  ).toHaveLength(0)
})

test('production build: theme still applies before paint under the real CSP, no flash', async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem('amcore-theme', 'dark'))

  await page.goto(productPath('/login'))

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe(true)
})

test('production build: the authenticated dashboard (sidebar style= attributes included) produces no CSP violations', async ({
  page,
}) => {
  // The authenticated shell exercises sidebar markup absent from the public login page.
  const violations: string[] = []
  await page.exposeFunction('__reportCspViolation', (detail: string) => violations.push(detail))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      // @ts-expect-error -- exposed by exposeFunction above
      window.__reportCspViolation(`${event.violatedDirective}: ${event.blockedURI}`)
    })
  })

  await registerViaUi(page, uniqueEmail('csp-dashboard'), { name: 'E2E Test' })
  await expect(page).toHaveURL(isProductHome)
  await page.waitForLoadState('networkidle')

  // Also exercises the mobile Sheet variant (a second, structurally
  // different sidebar render) while we have a real authenticated session.
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: messages.nav.toggleSidebar, exact: true }).click()
  await expect(page.locator('[data-slot="sidebar"][data-mobile="true"]')).toBeVisible()
  await waitForAnimationsToFinish(page, '[data-slot="sidebar"][data-mobile="true"]')

  expect(
    violations,
    `unexpected CSP violations on the dashboard: ${violations.join(', ')}`
  ).toHaveLength(0)
})
