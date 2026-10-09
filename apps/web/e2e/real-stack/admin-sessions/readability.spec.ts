import { expect, test } from '@playwright/test'

import { expectNoAxeViolations, scanAccessibility } from '../../shared/axe'
import { setSystemRole } from '../admin-helpers'
import { loginViaUi, registerViaUi, uniqueEmail } from '../helpers'
import { holdSessionRefetch, waitForSessionTransitions } from '../sessions-readability'

for (const theme of ['light', 'dark']) {
  for (const mobile of [false, true]) {
    test(`Console retained refetch rows: ${theme}, ${mobile ? 'mobile' : 'desktop'}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: mobile ? 390 : 1280, height: 900 })
      await page.addInitScript((value) => localStorage.setItem('amcore-theme', value), theme)
      const email = uniqueEmail('contrast-admin')
      await registerViaUi(page, email, { name: email })
      await expect(page).toHaveURL(/\/en\/?$/)
      setSystemRole(email, 'SUPER_ADMIN')
      await page.context().clearCookies()
      await loginViaUi(page, email)
      await expect(page).toHaveURL(/\/en\/?$/)
      await page.goto('/en/admin/users')
      await page.getByRole('link', { name: email }).click()
      const card = page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByRole('heading', { name: /sessions \(/i }) })
      const rows = card.locator('[aria-busy]:visible')
      const refresh = card.getByRole('button', { name: 'Refresh', exact: true })
      await expect(card.getByRole('heading', { name: 'Sessions (2 total)' })).toBeVisible()
      await expect(rows).toHaveAttribute('aria-busy', 'false')
      await expect(refresh).toBeEnabled()
      await waitForSessionTransitions(card)
      const badgeSelector = 'header span[class~="bg-console-accent/8"]'
      await expect(page.locator(badgeSelector)).toHaveText('CO')
      const contrast = await scanAccessibility(page, {
        include: badgeSelector,
        rules: ['color-contrast'],
      })
      expect(contrast.violations).toEqual([])
      expect(contrast.passes.find((rule) => rule.id === 'color-contrast')?.nodes).toHaveLength(1)
      const retained = await rows.innerText()
      const held = await holdSessionRefetch(page, '**/api/console/users/*/sessions?*')
      try {
        await refresh.click()
        await expect.poll(() => held.captured).toBe(1)
        await expect(rows).toHaveAttribute('aria-busy', 'true')
        await expect(refresh).toBeDisabled()
        await expect(refresh.locator('.animate-spin')).toBeVisible()
        await expect(rows).toHaveText(retained, { useInnerText: true })
        await expect(card.getByRole('heading', { name: 'Sessions (2 total)' })).toBeVisible()
        expect(held.released).toBe(false)
        await expectNoAxeViolations(page, { allowBusy: true })
        expect(held.released).toBe(false)
        held.release()
        await expect(rows).toHaveAttribute('aria-busy', 'false')
        await expect(refresh).toBeEnabled()
        await expect(refresh.locator('.animate-spin')).toHaveCount(0)
        await expect(rows).toHaveText(retained, { useInnerText: true })
        await waitForSessionTransitions(card)
        await expectNoAxeViolations(page)
      } finally {
        await held.dispose()
      }
    })
  }
}
