import { PRODUCT_ADMIN_CONFIG, productAdminPath } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import en from '../../messages/en.json'
import ru from '../../messages/ru.json'
import { expectDocumentTitle, verifyUrlOnlyLocale } from '../shared/url-only-locale-journey'
import { saveContextDiagnostics } from '../support/context-read-diagnostics'
import { activeTarget } from '../support/managed-target.mjs'

import { ensureAdministrationSession, registerViaUi, uniqueEmail } from './helpers'

const staffOrigin = () => {
  if (PRODUCT_ADMIN_CONFIG.mode === 'path') return ''
  const origin = activeTarget().origins.staff
  if (!origin) throw new Error('Expected the configured product admin host')
  return origin
}

for (const [scope, path] of [
  ['site', '/mfa'],
  ['staff', productAdminPath('/mfa')],
]) {
  const hostLabel = scope === 'staff' && PRODUCT_ADMIN_CONFIG.mode === 'host' ? ' (staff)' : ''
  test(`whole pending MFA document adds no product profile calls: ${path}${hostLabel}`, async ({
    page,
  }) => {
    await verifyUrlOnlyLocale(
      page,
      path,
      {
        title: { en: en.meta.title, ru: ru.meta.title },
        en: en.accountMfa.sessionChanged,
        ru: ru.accountMfa.sessionChanged,
      },
      scope === 'staff' ? staffOrigin() : ''
    )
  })
}

test('standalone product-admin denied document adds no product profile calls', async ({ page }) => {
  const email = uniqueEmail('locale-denied')
  await registerViaUi(page, email)
  await ensureAdministrationSession(page.context(), email)
  const denied = await page.context().newPage()
  try {
    await verifyUrlOnlyLocale(
      denied,
      productAdminPath('/organizations/not-a-valid-id'),
      {
        title: { en: en.meta.title, ru: ru.meta.title },
        en: en.productAdmin.unavailableTitle,
        ru: ru.productAdmin.unavailableTitle,
      },
      staffOrigin()
    )
  } finally {
    await denied.close()
  }
})

// Controlled document-state simulation, separate from the real EN/RU Next journeys above.
test('title readiness waits for delayed empty and stale metadata', async ({ page }) => {
  const evidence: Array<{
    initial: string
    completedBeforeRelease: boolean
    completedAfterRelease: boolean
  }> = []
  try {
    await page.setContent('<!doctype html><html><head></head><body></body></html>')
    await page.evaluate((title) => {
      document.title = title
    }, en.meta.title)
    await expectDocumentTitle(page, en.meta.title)
    for (const initial of ['', 'stale-metadata']) {
      await page.evaluate((title) => {
        document.title = title
      }, initial)
      let completed = false
      const waiting = expectDocumentTitle(page, en.meta.title).then(() => {
        completed = true
      })
      void waiting.catch(() => undefined)
      await expect(page).not.toHaveTitle(en.meta.title)
      expect(completed).toBe(false)
      const before = completed
      await page.evaluate((title) => {
        document.title = title
      }, en.meta.title)
      await waiting
      expect(completed).toBe(true)
      evidence.push({
        initial: initial ? 'stale' : 'empty',
        completedBeforeRelease: before,
        completedAfterRelease: completed,
      })
    }
  } finally {
    await saveContextDiagnostics(test.info(), 'locale-metadata', {
      controlledTitleCompletion: evidence,
    })
  }
})
