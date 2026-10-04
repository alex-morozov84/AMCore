import { SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { activeTarget, guardedExec, guardedSql } from '../support/managed-target.mjs'

import { directApi, proveOwnedRefresh } from './credential-containment.helpers'
import { TEST_PASSWORD, uniqueEmail } from './helpers'
import { organizationUi } from './organization-context.helpers'

test('organization foundation: ordered lifecycle, targets, session fence and responsive UI', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.name))
  const email = uniqueEmail('organization-context')
  const ui = organizationUi()
  const origin = activeTarget().origins.product
  const registration = await context.request.post('/api/auth/register', {
    headers: { origin },
    data: { email, password: TEST_PASSWORD },
  })
  expect(registration.status()).toBe(201)
  const login = await directApi('auth/login', { email, password: TEST_PASSWORD })
  const actor = login.user
  const first = await directApi('organizations', { name: 'Company Alpha' }, login.accessToken)
  const calls: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/product-access/')) calls.push(path)
  })

  await page.goto(ui.path())
  await expect(page).toHaveURL(new RegExp(`${ui.path(`/${first.id}`)}$`))
  await expect(page.getByRole('heading', { name: 'Company Alpha', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: ui.text('access') })).toBeVisible()
  await expect(page.getByText(ui.text('permitted'), { exact: true })).toBeVisible()
  expect(calls).toEqual([
    '/api/product-access/bootstrap',
    '/api/product-access/organizations',
    '/api/product-access/bootstrap',
    `/api/product-access/organizations/${first.id}/context`,
  ])
  await page.getByRole('link', { name: ui.text('all'), exact: true }).click()
  await expect(page).toHaveURL(/view=list/)
  await expect(page.getByRole('link', { name: ui.open('Company Alpha') })).toBeVisible()
  await expectNoAxeViolations(page)

  const second = await directApi(
    'organizations',
    { name: 'Company Beta with a deliberately long organization name for narrow screens' },
    login.accessToken
  )
  await page.getByRole('button', { name: ui.text('refresh'), exact: true }).click()
  await expect(page.getByRole('link', { name: ui.open(second.name) })).toBeVisible()
  await page.getByRole('link', { name: ui.open('Company Alpha') }).click()
  await expect(page.getByRole('heading', { name: 'Company Alpha', exact: true })).toBeVisible()
  const other = await context.newPage()
  await other.goto(ui.path(`/${second.id}`))
  await expect(other.getByRole('heading', { name: second.name, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Company Alpha', exact: true })).toBeVisible()
  await other.close()

  const beforeResume = calls.length
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })
  await expect(page.locator('[aria-busy="true"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Company Alpha', exact: true })).toBeVisible()
  expect(calls.slice(beforeResume)).toEqual([
    '/api/product-access/bootstrap',
    `/api/product-access/organizations/${first.id}/context`,
  ])

  const cookie = (await context.cookies()).find((value) => value.name === 'amcore_session')!
  await proveOwnedRefresh(cookie.value, actor, async () => {
    const beforeRefresh = calls.length
    await page.getByRole('button', { name: ui.text('refresh'), exact: true }).click()
    await expect(page.locator('[aria-busy="false"]')).toBeVisible()
    expect(calls.slice(beforeRefresh)).toEqual([
      '/api/product-access/bootstrap',
      `/api/product-access/organizations/${first.id}/context`,
    ])
  })

  // Current authority changes without replacing this actor's session or selected URL.
  guardedSql(
    `DELETE FROM core.member_roles WHERE "memberId" IN (SELECT id FROM core.org_members WHERE "userId"=:'actor' AND "organizationId"=:'org'); UPDATE core.organizations SET "aclVersion"="aclVersion"+1 WHERE id=:'org';`,
    { actor: actor.id, org: first.id }
  )
  await page.getByRole('button', { name: ui.text('refresh'), exact: true }).click()
  await expect(page.getByText(ui.text('notPermitted'), { exact: true })).toBeVisible()
  guardedSql(
    `DELETE FROM core.org_members WHERE "userId"=:'actor' AND "organizationId"=:'org'; UPDATE core.organizations SET "aclVersion"="aclVersion"+1 WHERE id=:'org';`,
    { actor: actor.id, org: first.id }
  )
  await page.getByRole('button', { name: ui.text('refresh'), exact: true }).click()
  await expect(page.getByText(ui.text('unavailableTitle'), { exact: true })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(ui.path(`/${first.id}`))
  await expect(page.getByText('Company Alpha', { exact: true })).toHaveCount(0)

  for (const locale of SUPPORTED_LOCALES)
    for (const dark of [false, true])
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
        await page.goto(organizationUi(locale).path(`/${second.id}`))
        await expect(page.getByRole('heading', { name: second.name, exact: true })).toBeVisible()
        await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*\bdark\b).*$/)
        await expectNoAxeViolations(page)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true)
        await page.screenshot({
          path: test.info().outputPath(`context-${locale}-${dark ? 'dark' : 'light'}-${width}.png`),
          fullPage: true,
        })
      }

  const lastUi = organizationUi(SUPPORTED_LOCALES.at(-1)!)
  await page
    .getByRole('button', { name: /sidebar|меню|панел/i })
    .first()
    .click()
  const mobile = page.locator('[data-slot="sidebar"][data-mobile="true"]')
  await expect(mobile).toBeVisible()
  await mobile.getByRole('link', { name: lastUi.text('title'), exact: true }).click()
  await expect(mobile).toHaveCount(0)
  await expect(page.getByRole('heading', { name: second.name, exact: true })).toBeVisible()

  const beforeChanged = calls.length
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { origin },
        data: { email, password: TEST_PASSWORD },
      })
    ).status()
  ).toBe(200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText(lastUi.text('changedTitle'), { exact: true })).toBeVisible()
  expect(calls.slice(beforeChanged)).toEqual(['/api/product-access/bootstrap'])
  await expect(page.getByText(second.name, { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
  // Vault capability checks above mutate only this cookie; never reset shared counters or limits.
  expect(
    guardedExec('redis', 'redis-cli', 'EXISTS', `web:session:v1:${cookie.value}`).trim()
  ).toMatch(/^[01]$/)
})

test('empty discovery and pagination remain distinct from failed authority', async ({
  page,
  context,
}) => {
  const ui = organizationUi()
  const origin = activeTarget().origins.product
  const email = uniqueEmail('org-empty')
  expect(
    (
      await context.request.post('/api/auth/register', {
        headers: { origin },
        data: { email, password: TEST_PASSWORD },
      })
    ).status()
  ).toBe(201)
  await page.goto(ui.path())
  await expect(page.getByRole('heading', { name: ui.text('emptyTitle') })).toBeVisible()
  await expectNoAxeViolations(page)
  const login = await directApi('auth/login', { email, password: TEST_PASSWORD })
  for (let index = 0; index < 21; index++)
    await directApi(
      'organizations',
      { name: `Page company ${String(index).padStart(2, '0')}` },
      login.accessToken
    )
  await page.getByRole('button', { name: ui.text('refresh'), exact: true }).click()
  await expect(page.getByRole('link', { name: new RegExp(ui.open('Page company')) })).toHaveCount(
    20
  )
  await page.getByRole('link', { name: ui.text('next'), exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByRole('link', { name: new RegExp(ui.open('Page company')) })).toHaveCount(1)
  await page.route('**/api/product-access/bootstrap', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'private diagnostic',
        errorCode: 'INTERNAL_ERROR',
        statusCode: 503,
      }),
    })
  )
  await page.getByRole('button', { name: ui.text('refresh'), exact: true }).click()
  await expect(page.getByText(ui.text('emptyTitle'))).toHaveCount(0)
  await expect(page.getByText('private diagnostic')).toHaveCount(0)
  // Next's route announcer also has role="alert"; assert the application's Alert.
  await expect(page.locator('[data-slot="alert"][role="alert"]')).toBeVisible()
})
