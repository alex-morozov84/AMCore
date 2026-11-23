import { expect, test } from '@playwright/test'

import { expectNoAxeViolations, waitForAnimationsToFinish } from '../shared/axe'
import { isProductHome, messages, productPath } from '../shared/product-settings'

import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'
import { waitForSessionTransitions } from './sessions-readability'

/**
 * Automated WCAG A/AA scans (Track 7 FINAL PLAN §5) on the pages that
 * need a real session — `page.route()` can't fake `requireSession()`, so
 * these live in the real-stack lane rather than the mocked one.
 */

test('the authenticated dashboard has no axe violations', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('axe-dashboard'), { name: 'E2E Test' })
  await expect(page).toHaveURL(isProductHome)

  await expectNoAxeViolations(page)
})

test('the sessions page has no axe violations, including with the row-actions menu open', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('axe-sessions')
  await registerViaUi(page, email, { name: 'E2E Test' })
  await expect(page).toHaveURL(isProductHome)

  await page.goto(productPath('/settings/sessions'))
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1)
  await expect(
    page.locator('tbody').getByText(messages.sessions.current, { exact: true })
  ).toBeVisible()
  await expect(page.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false')
  await waitForSessionTransitions(page.locator('[aria-busy]'))
  await expectNoAxeViolations(page)

  // A second real session so a row-actions menu exists to open — the
  // current session never renders one (`SessionsTable.tsx`).
  const otherContext = await browser.newContext()
  try {
    const otherPage = await otherContext.newPage()
    await loginViaUi(otherPage, email)
    await expect(otherPage).toHaveURL(isProductHome)

    await page.reload()
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2)
    await expect(
      page.locator('tbody').getByText(messages.sessions.current, { exact: true })
    ).toBeVisible()
    await expect(page.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'false')
    await waitForSessionTransitions(page.locator('[aria-busy]'))
    await page.getByRole('button', { name: messages.sessions.actions, exact: true }).click()
    await page.getByRole('menuitem', { name: messages.sessions.revoke, exact: true }).waitFor()
    await waitForAnimationsToFinish(page, '[data-slot="dropdown-menu-content"]')
    await waitForSessionTransitions(page.getByRole('menu'))

    await expectNoAxeViolations(page)
  } finally {
    await otherContext.close()
  }
})
