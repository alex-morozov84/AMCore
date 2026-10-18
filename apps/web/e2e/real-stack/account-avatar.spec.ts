import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE } from '@amcore/shared'
import { expect, type Page, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget } from '../support/managed-target.mjs'

import { registerViaUi, signOutViaUi, uniqueEmail } from './helpers'

/**
 * Account menu, profile dialog and avatar editing against the real stack: a real upload through
 * the BFF to `apps/api`, the media pipeline and the configured public base. The image must load
 * from the public files origin the web CSP allows (`WEB_PUBLIC_FILES_ORIGIN`); this lane runs the
 * enforcing production CSP, so a blocked image would be a recorded violation here.
 */
// Texts come from the active catalogue, so the spec follows the project's locale choice.
const t = JSON.parse(
  readFileSync(join(activeTarget().snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
).account

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const png = (name = 'photo.png', buffer: Buffer = PNG) => ({
  name,
  mimeType: 'image/png',
  buffer,
})

async function collectCspViolations(page: Page): Promise<string[]> {
  const violations: string[] = []
  await page.exposeFunction('__reportCspViolation', (detail: string) => violations.push(detail))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      // @ts-expect-error -- exposed by exposeFunction above
      window.__reportCspViolation(`${event.violatedDirective}: ${event.blockedURI}`)
    })
  })
  return violations
}

async function openProfile(page: Page) {
  await page.getByLabel(t.menuLabel).click()
  await page.getByRole('menuitem', { name: t.profile }).click()
  const dialog = page.getByRole('dialog', { name: t.profileTitle })
  await expect(dialog).toBeVisible()
  return dialog
}

async function expectLoaded(image: ReturnType<Page['locator']>) {
  await expect(image).toBeVisible()
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
}

test.describe('account menu and avatar', () => {
  test('uploads, replaces and removes a photo that loads from the public files origin', async ({
    page,
  }) => {
    const violations = await collectCspViolations(page)
    await registerViaUi(page, uniqueEmail('avatar'), { name: 'Avatar Fixture' })

    // Found by label, not role: an open modal dialog hides the rest of the page from role queries.
    const trigger = page.getByLabel(t.menuLabel)
    await expect(trigger).toContainText('Avatar Fixture')
    await expect(trigger.locator('[data-initials="AF"]')).toBeVisible()

    const dialog = await openProfile(page)
    await expect(dialog.getByText('Avatar Fixture')).toBeVisible()
    await dialog.getByLabel(t.avatar.photoLabel, { exact: true }).setInputFiles(png())
    await expect(dialog.getByText(t.avatar.uploaded)).toBeVisible()

    const headerImage = trigger.locator('img')
    await expectLoaded(headerImage)
    const first = await headerImage.getAttribute('src')
    expect(first).toContain('/storage/public')
    await expectLoaded(dialog.getByRole('img'))

    // Replace: a new upload yields a new versioned URL.
    await dialog.getByLabel(t.avatar.photoLabel, { exact: true }).setInputFiles(png('second.png'))
    await expect(headerImage).not.toHaveAttribute('src', first!)
    await expectLoaded(headerImage)

    // Remove needs the confirmation, then the initials come back.
    await dialog.getByRole('button', { name: t.avatar.remove }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: t.avatar.removeConfirm })
      .click()
    await expect(dialog.getByText(t.avatar.removed)).toBeVisible()
    await expect(trigger.locator('[data-initials="AF"]')).toBeVisible()

    expect(violations, `CSP violations: ${violations.join(', ')}`).toHaveLength(0)
  })

  test('refuses a wrong file type and an oversized photo with a clear message', async ({
    page,
  }) => {
    await registerViaUi(page, uniqueEmail('avatar-refuse'), { name: 'Avatar Refuse' })
    const dialog = await openProfile(page)
    const input = dialog.getByLabel(t.avatar.photoLabel, { exact: true })

    await input.setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    })
    await expect(dialog.getByText(t.avatar.invalidType)).toBeVisible()

    await input.setInputFiles(png('big.png', Buffer.alloc(2 * 1024 * 1024 + 1)))
    await expect(dialog.getByText(t.avatar.tooLarge)).toBeVisible()
    await expect(dialog.getByRole('button', { name: t.avatar.remove })).toHaveCount(0)
  })

  test('works with the keyboard only and returns focus to the menu button', async ({ page }) => {
    await registerViaUi(page, uniqueEmail('avatar-keys'), { name: 'Avatar Keys' })
    // Found by label, not role: an open modal dialog hides the rest of the page from role queries.
    const trigger = page.getByLabel(t.menuLabel)
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: t.profileTitle })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('has no axe violations with the menu and the dialog open', async ({ page }) => {
    await registerViaUi(page, uniqueEmail('avatar-axe'), { name: 'Avatar Axe' })
    await page.getByLabel(t.menuLabel).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expectNoAxeViolations(page)
    await page.keyboard.press('Escape')
    await openProfile(page)
    await expectNoAxeViolations(page)
  })

  test('fits a narrow screen: only the avatar shows, the menu still works', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await registerViaUi(page, uniqueEmail('avatar-narrow'), { name: 'Avatar Narrow' })
    // Found by label, not role: an open modal dialog hides the rest of the page from role queries.
    const trigger = page.getByLabel(t.menuLabel)
    await expect(trigger).toBeVisible()
    await expect(trigger.getByText('Avatar Narrow')).toBeHidden()
    await trigger.click()
    await expect(page.getByRole('menuitem', { name: /sign out/i })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })

  test('signs out from the menu', async ({ page }) => {
    await registerViaUi(page, uniqueEmail('avatar-logout'), { name: 'Avatar Logout' })
    await signOutViaUi(page)
    await expect(page).toHaveURL(/\/login/)
  })
})
