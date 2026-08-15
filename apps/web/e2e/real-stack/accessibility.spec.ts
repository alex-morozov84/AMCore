import { expect, test } from '@playwright/test'

import { expectNoAxeViolations, waitForAnimationsToFinish } from '../shared/axe'

import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'

/**
 * Automated WCAG A/AA scans (Track 7 FINAL PLAN §5) on the pages that
 * need a real session — `page.route()` can't fake `requireSession()`, so
 * these live in the real-stack lane rather than the mocked one.
 */

test('the authenticated dashboard has no axe violations', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('axe-dashboard'), { name: 'E2E Test' })
  await expect(page).toHaveURL(/\/en\/?$/)

  await expectNoAxeViolations(page)
})

test('the sessions page has no axe violations, including with the row-actions menu open', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('axe-sessions')
  await registerViaUi(page, email, { name: 'E2E Test' })
  await expect(page).toHaveURL(/\/en\/?$/)

  await page.goto('/en/settings/sessions')
  await expect(page.getByRole('table')).toBeVisible()
  await expectNoAxeViolations(page)

  // A second real session so a row-actions menu exists to open — the
  // current session never renders one (`SessionsTable.tsx`).
  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()
  await loginViaUi(otherPage, email)
  await expect(otherPage).toHaveURL(/\/en\/?$/)

  await page.reload()
  await page.getByRole('button', { name: /actions/i }).click()
  await page.getByRole('menuitem', { name: /revoke/i }).waitFor()
  await waitForAnimationsToFinish(page, '[data-slot="dropdown-menu-content"]')

  await expectNoAxeViolations(page)

  await otherContext.close()
})
