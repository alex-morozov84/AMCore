import { expect, type Page, test } from '@playwright/test'

import { saveContextDiagnostics } from '../support/context-read-diagnostics'

import { expectNoAxeViolations } from './axe'

/** Counter spans the entire document, including ancestors and post-switch effects. */
export async function verifyUrlOnlyLocale(
  page: Page,
  path: string,
  ready: { en: string; ru: string; title: { en: string; ru: string } }
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
    await page.goto(`/en${path}?tag=a&tag=b#locale`)
    await expect(page.getByRole('main').getByText(ready.en, { exact: true })).toBeVisible()
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    await capture('ready-ui-en', ready.title.en)
    await expectDocumentTitle(page, ready.title.en)
    await capture('before-axe-en', ready.title.en)
    await expectNoAxeViolations(page)
    expect(profileCalls).toBe(0)
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ru')
    await expect(page).toHaveURL(`${new URL(page.url()).origin}/ru${path}?tag=a&tag=b#locale`)
    await expect(page.getByRole('main').getByText(ready.ru, { exact: true })).toBeVisible()
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Язык', exact: true })).toBeEnabled()
    await capture('ready-ui-ru', ready.title.ru)
    await expectDocumentTitle(page, ready.title.ru)
    await capture('before-axe-ru', ready.title.ru)
    await expectNoAxeViolations(page)
    expect(profileCalls).toBe(0)
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
