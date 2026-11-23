import { DEFAULT_LOCALE, SERVED_LOCALES } from '@amcore/shared'
import { expect, type Page, test } from '@playwright/test'

import { saveContextDiagnostics } from '../support/context-read-diagnostics'

import { expectNoAxeViolations } from './axe'
import { messagesForLocale, productPath } from './product-settings'

/** Counter spans the entire document, including ancestors and post-switch effects. */
export async function verifyUrlOnlyLocale(
  page: Page,
  path: string,
  ready: { en: string; ru: string; title: { en: string; ru: string } },
  origin = ''
) {
  let profileCalls = 0
  let profileTruncated = false
  const metadata: Array<Record<string, unknown>> = []
  let primaryFailed = false
  let primaryError: unknown
  const capture = async (phase: string, expected: string) => {
    const title = await page.title()
    metadata.push({
      phase,
      titlePresent: /\S/.test(title),
      titleMatches: title === expected,
      language: await page.locator('html').getAttribute('lang'),
      headTitles: await page.locator('head title').count(),
      bodyTitles: await page.locator('body title').count(),
    })
  }
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/me') {
      if (profileCalls < 1024) profileCalls++
      else profileTruncated = true
    }
  })
  try {
    const first = DEFAULT_LOCALE
    const second = SERVED_LOCALES.find((locale) => locale !== first)
    await page.goto(`${origin}${productPath(path, first)}?tag=a&tag=b#locale`)
    await expect(page.getByRole('main').getByText(ready[first], { exact: true })).toBeVisible()
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('lang', first)
    await capture(`ready-ui-${first}`, ready.title[first])
    await expectDocumentTitle(page, ready.title[first])
    await capture(`before-axe-${first}`, ready.title[first])
    await expectNoAxeViolations(page)
    expect(profileCalls).toBe(0)
    if (!second) {
      await expect(page.getByRole('combobox')).toHaveCount(0)
      await expect(page).toHaveURL(`${new URL(page.url()).origin}${path}?tag=a&tag=b#locale`)
    } else {
      await page
        .getByRole('combobox', { name: messagesForLocale(first).locale.label, exact: true })
        .selectOption(second)
      await expect(page).toHaveURL(
        `${new URL(page.url()).origin}${productPath(path, second)}?tag=a&tag=b#locale`
      )
      await expect(page.getByRole('main').getByText(ready[second], { exact: true })).toBeVisible()
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
      await expect(page.locator('html')).toHaveAttribute('lang', second)
      await expect(
        page.getByRole('combobox', { name: messagesForLocale(second).locale.label, exact: true })
      ).toBeEnabled()
      await capture(`ready-ui-${second}`, ready.title[second])
      await expectDocumentTitle(page, ready.title[second])
      await capture(`before-axe-${second}`, ready.title[second])
      await expectNoAxeViolations(page)
      expect(profileCalls).toBe(0)
    }
  } catch (error) {
    primaryFailed = true
    primaryError = error
  }
  try {
    await saveContextDiagnostics(test.info(), 'locale-metadata', {
      metadata,
      profileCalls,
      profileTruncated,
    })
  } catch {
    test.info().annotations.push({
      type: 'diagnostic-error',
      description: 'Safe metadata report could not be saved',
    })
    if (!primaryFailed) throw new Error('Safe metadata report could not be saved')
  }
  if (primaryFailed) throw primaryError
}

/** Metadata may stream after main UI; the exact catalogue title is the readiness signal. */
export async function expectDocumentTitle(page: Page, title: string) {
  await expect(page).toHaveTitle(title)
}
