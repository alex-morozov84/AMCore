import { randomUUID } from 'node:crypto'

import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

import { guardedSql } from '../support/managed-target.mjs'

import { ageSessionLastAuthAt, getUserId, setSystemRole } from './admin-helpers'
import { loginViaUi, registerViaUi, TEST_PASSWORD, uniqueEmail } from './helpers'

async function settleFiniteAnimations(page: Page) {
  await page.evaluate(async () => {
    let idleFrames = 0
    for (let frame = 0; frame < 30; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const active = document.getAnimations().filter((animation) => {
        const end = animation.effect?.getComputedTiming().endTime
        return animation.playState !== 'finished' && typeof end === 'number' && Number.isFinite(end)
      })
      idleFrames = active.length ? 0 : idleFrames + 1
      if (idleFrames === 2) return
      for (const animation of active) animation.finish()
    }
    throw new Error('Finite animations did not settle before the accessibility scan')
  })
}

function seedKeys(userId: string) {
  const organizationId = randomUUID()
  const keys = Array.from({ length: 22 }, (_, index) => ({
    id: `c${randomUUID().replaceAll('-', '').slice(0, 24)}`,
    name: `Lifecycle ${String(index).padStart(2, '0')}`,
    shortToken: `fixture-${index}-${organizationId}`,
    age: index,
  }))
  guardedSql(
    `INSERT INTO core.organizations (id,name,slug,"updatedAt") VALUES (:'org','Key review',:'org',now());
 INSERT INTO core.api_keys (id,name,"shortToken","keyHash",salt,scopes,"userId","organizationId","createdAt","expiresAt")
 SELECT id,name,"shortToken",'fake-fixture-verifier','fake-fixture-salt',ARRAY['read:User'],:'user',:'org',now() - (age * interval '1 minute'), NULL
 FROM jsonb_to_recordset(:'keys'::jsonb) AS r(id text,name text,"shortToken" text,age int);`,
    { org: organizationId, user: userId, keys: JSON.stringify(keys) }
  )
  guardedSql(`UPDATE core.api_keys SET "expiresAt" = now() - interval '1 day' WHERE id = :'id';`, {
    id: keys[21]!.id,
  })
  return { keys, organizationId }
}
test('platform key discovery, captured bulk step-up, lifecycle history and responsive access', async ({
  page,
}) => {
  const email = uniqueEmail('keys-admin')
  await registerViaUi(page, email)
  setSystemRole(email, 'SUPER_ADMIN')
  await page.context().clearCookies()
  await loginViaUi(page, email)
  await expect(page).toHaveURL(/\/en\/?$/)
  const ownerId = getUserId(email),
    { keys, organizationId } = seedKeys(ownerId)
  await page.goto(`/en/admin/api-keys?userId=${ownerId}&organizationId=${organizationId}&limit=20`)
  await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible()
  await expect(page.getByText('22 keys', { exact: true })).toBeVisible()
  const search = page.getByRole('textbox', { name: 'Search key names' })
  await search.fill('Lifecycle')
  await expect(page).toHaveURL(/search=Lifecycle/)
  expect(new URL(page.url()).searchParams.get('userId')).toBe(ownerId)
  await page.getByRole('link', { name: 'Next', exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByRole('row').filter({ hasText: 'Lifecycle 21' })).toBeVisible()
  await page.goBack()
  await expect(page).not.toHaveURL(/page=2/)
  await expect(page.getByRole('row').filter({ hasText: 'Lifecycle 00' })).toBeVisible()
  await expect(search).toHaveValue('Lifecycle')
  await search.fill('Lifecycle 00')
  await expect(page).toHaveURL(/search=Lifecycle(?:\+|%20)00/)
  await expect(page.getByRole('row').filter({ hasText: 'Lifecycle 00' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Lifecycle 01' })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Select eligible keys on this page' }).check()
  ageSessionLastAuthAt(email)
  const mutations: number[] = [],
    stepUpBodies: string[] = []
  page.on('response', (response) => {
    if (
      response.url().includes('/api/console/api-keys/') &&
      response.request().method() === 'DELETE'
    )
      mutations.push(response.status())
  })
  await page.route('**/api/console/auth/step-up', async (route) => {
    const response = await route.fetch()
    stepUpBodies.push(await response.text())
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Revoke selected (1)' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Lifecycle 00')
  await confirm.getByRole('button', { name: 'Revoke', exact: true }).click()
  const stepUp = page.getByRole('dialog')
  await expect(stepUp).toBeVisible()
  await stepUp.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  await stepUp.getByRole('button', { name: /confirm|continue|verify/i }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Lifecycle 00' })).toContainText('Revoked')
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeFocused()
  expect(mutations).toEqual([403, 200])
  expect(stepUpBodies.every((body) => !body.includes('accessToken'))).toBe(true)
  expect(
    guardedSql(
      `SELECT count(*) FROM core.api_keys WHERE id=:'id' AND "keyHash" IS NULL AND salt IS NULL AND "revokedAt" IS NOT NULL;`,
      { id: keys[0]!.id }
    ).trim()
  ).toBe('1')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await settleFiniteAnimations(page)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('Lifecycle 00', { exact: true }).last()).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.goto(`/ru/admin/api-keys?id=${keys[0]!.id}`)
  await expect(page.getByRole('heading', { name: 'API-ключи', exact: true })).toBeVisible()
  await expect(page.getByText('Отозван', { exact: true }).last()).toBeVisible()
  setSystemRole(email, 'USER')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'API-ключи', exact: true })).toHaveCount(0)
})
