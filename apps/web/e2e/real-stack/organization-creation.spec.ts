import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

import { browserCredentialRequest, TEST_PASSWORD, uniqueEmail } from './helpers'
import { organizationUi } from './organization-context.helpers'

for (const locale of SUPPORTED_LOCALES) {
  test(`creation ${locale}: occupied identifier is explained and cancel clears its error`, async ({
    page,
    context,
  }) => {
    const target = activeTarget()
    const ui = organizationUi(locale)
    const text = JSON.parse(
      readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
    ).organizationCreation
    const email = uniqueEmail(`slug-conflict-${locale}`)
    const registration = await browserCredentialRequest(context.request, '/api/auth/register', {
      headers: { origin: target.origins.product },
      data: { email, password: TEST_PASSWORD },
    })
    expect(registration.status()).toBe(201)
    const slug = `review-${locale}-${crypto.randomUUID()}`
    const bootstrap = await context.request.get('/api/product-access/bootstrap')
    expect(bootstrap.status()).toBe(200)
    const { binding } = await bootstrap.json()
    const initial = await context.request.post('/api/product-access/organizations', {
      headers: { origin: target.origins.product, 'X-AMCore-Context-Session': binding },
      data: { name: 'Original company', slug, operationId: crypto.randomUUID() },
    })
    expect(initial.status()).toBe(201)
    await page.goto(`${ui.path()}?view=list`)
    await page.getByRole('button', { name: text.create, exact: true }).click()
    await page.getByLabel(text.name, { exact: true }).fill('Second company')
    await page.getByLabel(text.slug, { exact: true }).fill(slug)
    const conflict = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/product-access/organizations') &&
        response.request().method() === 'POST'
    )
    await page.getByRole('button', { name: text.create, exact: true }).click()
    expect((await conflict).status()).toBe(409)
    await expect(page.getByText(text.slugTaken, { exact: true })).toBeVisible()
    await expect(page.getByLabel(text.name, { exact: true })).toHaveValue('Second company')
    await expect(page.getByLabel(text.slug, { exact: true })).toHaveValue(slug)
    await expectNoAxeViolations(page)
    await page.getByRole('button', { name: text.cancel, exact: true }).click()
    await expect(page.getByText(text.slugTaken, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: text.create, exact: true })).toBeFocused()
    await page.getByRole('button', { name: text.create, exact: true }).click()
    await expect(page.getByText(text.slugTaken, { exact: true })).toHaveCount(0)
    await expect(page.getByLabel(text.name, { exact: true })).toHaveValue('')
    await page.getByLabel(text.name, { exact: true }).fill('Second company')
    await page.getByLabel(text.slug, { exact: true }).fill(`${slug}-2`)
    await page.getByRole('button', { name: text.create, exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Second company', exact: true, level: 1 })
    ).toBeVisible()
  })

  test(`creation ${locale}: lost commit reply, reload and exact repeat create one organization`, async ({
    page,
    context,
  }) => {
    const target = activeTarget()
    const ui = organizationUi(locale)
    const text = JSON.parse(
      readFileSync(join(target.snapshot, `apps/web/messages/${locale}.json`), 'utf8')
    ).organizationCreation
    const email = uniqueEmail(`create-${locale}`)
    const registration = await browserCredentialRequest(context.request, '/api/auth/register', {
      headers: { origin: target.origins.product },
      data: { email, password: TEST_PASSWORD },
    })
    expect(registration.status()).toBe(201)
    await page.goto(ui.path())
    await page.setViewportSize({ width: 375, height: 900 })
    await page.getByRole('button', { name: text.create, exact: true }).click()
    await expect(page.getByLabel(text.name, { exact: true })).toBeFocused()
    await page.getByLabel(text.name, { exact: true }).fill(`New company ${locale}`)
    await page.getByRole('button', { name: text.cancel, exact: true }).click()
    await expect(page.getByRole('button', { name: text.create, exact: true })).toBeFocused()
    await page.getByRole('button', { name: text.create, exact: true }).click()
    await page.getByLabel(text.name, { exact: true }).fill(`New company ${locale}`)
    const operationIds: string[] = []
    const replyStatuses: number[] = []
    let discardReply = true
    await page.route('**/api/product-access/organizations', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      operationIds.push(route.request().postDataJSON().operationId)
      const response = await route.fetch()
      replyStatuses.push(response.status())
      expect(response.status()).toBe(201)
      if (discardReply) {
        discardReply = false
        await route.abort('failed')
      } else await route.fulfill({ response })
    })
    await page.getByRole('button', { name: text.create, exact: true }).click()
    await expect.poll(() => replyStatuses[0]).toBe(201)
    await expect(page.getByText(text.unknown, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText(text.unknown, { exact: true })).toBeVisible()
    // A newly present single membership must not bypass unresolved-operation recovery.
    expect(new URL(page.url()).pathname).toBe(ui.path())
    await expectNoAxeViolations(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: text.repeat, exact: true }).click()
    await expect.poll(() => replyStatuses.length).toBe(2)
    await expect(
      page.getByRole('heading', { name: `New company ${locale}`, exact: true, level: 1 })
    ).toBeVisible()
    expect(operationIds).toHaveLength(2)
    expect(operationIds[0]).toBe(operationIds[1])
    expect(
      guardedSql(
        'SELECT count(*) FROM core.organization_creation_results WHERE "operationId"=:\'id\';',
        { id: operationIds[0] }
      ).trim()
    ).toBe('1')
    expect(
      guardedSql(
        'SELECT count(*) FROM core.org_members m JOIN core.users u ON u.id=m."userId" WHERE u."emailCanonical"=:\'email\';',
        { email }
      ).trim()
    ).toBe('1')
    await expectNoAxeViolations(page)
  })
}
