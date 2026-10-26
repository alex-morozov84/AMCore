import { expect, type Page } from '@playwright/test'

import { expectNoAxeViolations } from './axe'

/** Counter spans the entire document, including ancestors and post-switch effects. */
export async function verifyUrlOnlyLocale(
  page: Page,
  path: string,
  ready: { en: string; ru: string }
) {
  const profile: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/me') profile.push(request.method())
  })
  await page.goto(`/en${path}?tag=a&tag=b#locale`)
  await expect(page.getByRole('main').getByText(ready.en, { exact: true })).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await expectNoAxeViolations(page)
  expect(profile).toEqual([])
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ru')
  await expect(page).toHaveURL(`${new URL(page.url()).origin}/ru${path}?tag=a&tag=b#locale`)
  await expect(page.getByRole('main').getByText(ready.ru, { exact: true })).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Язык', exact: true })).toBeEnabled()
  await expectNoAxeViolations(page)
  expect(profile).toEqual([])
}
