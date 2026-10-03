import { expect, type Page } from '@playwright/test'

import { expectNoAxeViolations } from './axe'

/** Shared assertion: both topologies use their own real BFF/session admission. */
export async function storageSettingJourney(
  page: Page,
  apiPath: string,
  beforeReset?: () => Promise<void>
): Promise<void> {
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'File storage', exact: true }) })
  let writes = 0
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes('runtime-settings/storage-probe')) writes++
  })
  const input = card.getByRole('spinbutton', { name: 'Probe interval (seconds)' })
  await expect(input).toHaveValue('600')
  await expect(card.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await input.fill('90')
  await card.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(writes).toBe(0)
  await expect(input).toHaveValue('600')
  await input.fill('60')
  await card.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await expect
    .poll(async () => (await (await page.request.get(apiPath)).json()).applied.intervalSeconds, {
      timeout: 40_000,
    })
    .toBe(60)
  expect(writes).toBe(1)
  await expect(card.getByRole('button', { name: /reset/i })).toHaveCount(0)
  await expectNoAxeViolations(page)
  await page.reload()
  await expect(input).toHaveValue('60')
  await beforeReset?.()
  // Operator reset remains an API contract, with no reset control in the UI.
  const reset = await page.request.patch(apiPath, {
    headers: { Origin: new URL(page.url()).origin },
    data: { intervalSeconds: null, expectedRevision: 1 },
  })
  expect(reset.status()).toBe(200)
  expect((await reset.json()).saved).toEqual({ intervalSeconds: null, revision: 2 })
}
