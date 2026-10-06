import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'

// Uses only an isolated managed stand and newly created accounts.
test('manager presentation: themes, reduced motion, CSS zoom and keyboard dismissal', async ({
  page,
  context,
}) => {
  const target = activeTarget()
  const c = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${SUPPORTED_LOCALES[0]}.json`), 'utf8')
  )
  const t = c.organizationInvitations
  const email = uniqueEmail('presentation-owner')
  expect(
    (
      await context.request.post('/api/auth/register', {
        headers: { origin: target.origins.product },
        data: { email, password: TEST_PASSWORD },
      })
    ).status()
  ).toBe(201)
  const login = await directApi('auth/login', { email, password: TEST_PASSWORD })
  const org = await directApi('organizations', { name: 'Presentation proof' }, login.accessToken)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const theme of ['light', 'dark'] as const) {
    await page.addInitScript((value) => localStorage.setItem('amcore-theme', value), theme)
    await page.goto(
      localizedFrontendUrl(
        target.origins.product,
        SUPPORTED_LOCALES[0],
        `organizations/${org.id}/invites`
      )
    )
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark).*$/)
    const trigger = page.getByRole('button', { name: t.invite, exact: true })
    await expect(trigger).toBeEnabled()
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('textbox', { name: t.email, exact: true })).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: 'MEMBER', exact: true })).toBeChecked()
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running')
    )
    await expectNoAxeViolations(page)
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2'
    })
    await expect(dialog.getByRole('textbox', { name: t.email, exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: t.invite, exact: true })).toBeVisible()
    expect(
      await dialog.evaluate((el) => el.getBoundingClientRect().width <= window.innerWidth)
    ).toBe(true)
    await expectNoAxeViolations(page)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1'
    })
  }
})
