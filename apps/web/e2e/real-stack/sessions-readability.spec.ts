import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'

import { loginViaUi, registerViaUi, uniqueEmail } from './helpers'
import { holdSessionRefetch, waitForSessionTransitions } from './sessions-readability'

for (const theme of ['light', 'dark']) {
  test(`Settings retained refetch rows: ${theme}`, async ({ page, browser }) => {
    await page.addInitScript((value) => localStorage.setItem('amcore-theme', value), theme)
    const email = uniqueEmail('contrast-settings')
    await registerViaUi(page, email)
    await expect(page).toHaveURL(/\/en\/?$/)
    const other = await browser.newContext()
    try {
      const otherPage = await other.newPage()
      await loginViaUi(otherPage, email)
      await expect(otherPage).toHaveURL(/\/en\/?$/)
      await page.goto('/en/settings/sessions')
      const wrapper = page.locator('[aria-busy]')
      const rows = page.getByRole('table').locator('tbody tr')
      await expect(rows).toHaveCount(2)
      await expect(page.locator('tbody').getByText('This device', { exact: true })).toBeVisible()
      await expect(wrapper).toHaveAttribute('aria-busy', 'false')
      await waitForSessionTransitions(wrapper)
      const retained = await wrapper.innerText()
      const held = await holdSessionRefetch(page, '**/api/auth/sessions?*')
      try {
        await page.getByRole('button', { name: /actions/i }).click()
        await page.getByRole('menuitem', { name: /revoke/i }).click()
        await expect.poll(() => held.captured).toBe(1)
        await expect(wrapper).toHaveAttribute('aria-busy', 'true')
        await expect(rows).toHaveCount(2)
        await expect(wrapper).toHaveText(retained, { useInnerText: true })
        await expect(page.locator('tbody').getByText('This device', { exact: true })).toBeVisible()
        expect(held.released).toBe(false)
        await expectNoAxeViolations(page)
        expect(held.released).toBe(false)
        held.release()
        await expect(wrapper).toHaveAttribute('aria-busy', 'false')
        await expect(rows).toHaveCount(1)
        await expect(page.locator('tbody').getByText('This device', { exact: true })).toBeVisible()
        const persisted = await page.request.get('/api/auth/sessions?page=1&limit=20')
        expect(persisted.ok()).toBe(true)
        expect((await persisted.json()).total).toBe(1)
        await waitForSessionTransitions(wrapper)
        await expectNoAxeViolations(page)
      } finally {
        await held.dispose()
      }
    } finally {
      await other.close()
    }
  })
}
