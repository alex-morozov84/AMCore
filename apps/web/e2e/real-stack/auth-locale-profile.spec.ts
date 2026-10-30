import { productAdminPath } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import en from '../../messages/en.json'
import ru from '../../messages/ru.json'
import { expectDocumentTitle, verifyUrlOnlyLocale } from '../shared/url-only-locale-journey'
import { saveContextDiagnostics } from '../support/context-read-diagnostics'

import { registerViaUi, uniqueEmail } from './helpers'

for (const path of ['/mfa', productAdminPath('/mfa')]) {
  test(`whole pending MFA document adds no product profile calls: ${path}`, async ({ page }) => {
    await verifyUrlOnlyLocale(page, path, {
      title: { en: en.meta.title, ru: ru.meta.title },
      en: en.accountMfa.sessionChanged,
      ru: ru.accountMfa.sessionChanged,
    })
  })
}

test('standalone product-admin denied document adds no product profile calls', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('locale-denied'))
  const denied = await page.context().newPage()
  try {
    await verifyUrlOnlyLocale(denied, productAdminPath('/organizations/not-a-valid-id'), {
      title: { en: en.meta.title, ru: ru.meta.title },
      en: en.productAdmin.unavailableTitle,
      ru: ru.productAdmin.unavailableTitle,
    })
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
