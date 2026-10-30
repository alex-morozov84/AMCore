import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { coerceSupportedLocale, localizedFrontendUrl } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { probeRefusalEvidence } from '../real-stack/helpers'
import { expectNoAxeViolations } from '../shared/axe'
import { completeMfaSignIn } from '../shared/mfa-login'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'
import { resetBrowserProbeDomainBudget } from '../support/mfa-domain-fixture.mjs'
import { proveSetupMailbox, SETUP_PASSWORD, setupCommand } from '../support/organization-setup'

test.use({ trace: 'off', video: 'off', screenshot: 'off' })

test('Console recovers a deleted recipient and lost replies without duplicating access', async ({
  page,
}) => {
  const m = activeTarget()
  const responses: Array<{ action: string; status: number; errorCode?: string }> = []
  page.on('response', async (response) => {
    const path = new URL(response.url()).pathname
    if (!path.includes('/organization-establishment/')) return
    const body = await response.json().catch(() => ({}))
    responses.push({
      action: path.split('/').at(-1)!,
      status: response.status(),
      errorCode: body.errorCode,
    })
  })
  const text = (locale: string) =>
    JSON.parse(readFileSync(join(m.snapshot, `apps/web/messages/${locale}.json`), 'utf8')).console
      .organizationSetup
  const login = JSON.parse(
    readFileSync(join(m.snapshot, `apps/web/messages/${coerceSupportedLocale('en')}.json`), 'utf8')
  ).auth
  const en = text(coerceSupportedLocale('en'))
  const ru = text(coerceSupportedLocale('ru'))
  const setup = page.locator('[data-slot="card"]').filter({
    has: page
      .getByRole('heading', { name: en.title, exact: true })
      .or(page.getByRole('heading', { name: ru.title, exact: true })),
  })
  const operator = 'operator@e2e.amcore.test'
  let recipient = 'anna@e2e.amcore.test'
  const preparedOperator = setupCommand('prepare-account', {
    email: operator,
    locale: coerceSupportedLocale('en'),
  })
  await proveSetupMailbox(page, operator)
  // Separate trusted platform-access fixture; organization setup never promotes SUPER_ADMIN.
  guardedSql(
    'UPDATE core.users SET "systemRole" = \'SUPER_ADMIN\' WHERE id = :\'id\' AND "emailVerified" = true;',
    { id: preparedOperator.userId }
  )
  await page.goto(localizedFrontendUrl(m.origins.console, coerceSupportedLocale('en'), 'login'))
  await page.getByRole('textbox', { name: login.email, exact: true }).fill(operator)
  await page.getByLabel(login.password, { exact: true }).fill(SETUP_PASSWORD)
  const signIn = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/auth/login') && r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: login.login, exact: true }).click()
  if ((await signIn).status() === 202) await completeMfaSignIn(page, operator)
  await page.waitForURL(
    (url) =>
      url.origin === m.origins.console &&
      url.pathname ===
        new URL(localizedFrontendUrl(m.origins.console, coerceSupportedLocale('en'))).pathname
  )
  await page.goto(
    localizedFrontendUrl(m.origins.console, coerceSupportedLocale('en'), 'organizations')
  )
  await setup.getByRole('button', { name: en.trustedStart, exact: true }).click()
  await expect(setup.getByRole('heading', { name: en.headings.administrator })).toBeVisible()
  await expectNoAxeViolations(page)

  const preparePattern = '**/api/organization-establishment/accounts/prepare'
  await page.route(preparePattern, async (route) => {
    await route.fetch()
    await route.abort()
  })
  await setup.getByLabel(en.email, { exact: true }).fill(recipient)
  await setup.getByRole('button', { name: en.continue, exact: true }).click()
  await expect(setup.getByText(en.unknown, { exact: true })).toBeVisible()
  await page.unroute(preparePattern)
  await page.reload()
  const repeat = setup.getByRole('button', { name: en.repeat, exact: true })
  try {
    await expect(repeat).toBeVisible()
  } catch {
    throw new Error(
      `Setup recovery unavailable: ${JSON.stringify({ responses, primary: await probeRefusalEvidence() })}`
    )
  }
  await repeat.click()
  await expect(setup.getByText(en.unverified, { exact: true })).toBeVisible()
  await expect(setup.getByText(en.mailHelp, { exact: true })).toBeVisible()
  await expect(setup.getByRole('button', { name: en.continue, exact: true })).toHaveCount(0)
  await expect(setup.getByLabel(en.name, { exact: true })).toHaveCount(0)
  const recipientPage = await page.context().newPage()
  await proveSetupMailbox(recipientPage, recipient)
  await setup.getByRole('button', { name: en.checkEmail, exact: true }).click()
  await expect(setup.getByText(en.verified, { exact: true })).toBeVisible()
  await setup.getByRole('button', { name: en.continue, exact: true }).click()
  await expect(setup.getByRole('heading', { name: en.headings.organization })).toBeVisible()
  await setup.getByLabel(en.name, { exact: true }).fill('Anna shop')
  await setup.getByLabel(en.slug, { exact: true }).fill('anna-shop')
  await setup.getByRole('button', { name: en.continue, exact: true }).click()
  await expect(setup.getByRole('heading', { name: en.headings.review })).toBeFocused()
  await setup.getByRole('button', { name: en.back, exact: true }).click()
  await expect(setup.getByLabel(en.name, { exact: true })).toHaveValue('Anna shop')

  // Start the independent deleted-recipient recovery case with an idle source budget.
  // This multi-case correctness exercise is not a sustained-load test.
  resetBrowserProbeDomainBudget()
  // Only this disposable managed fixture's recipient is deleted, never preview data.
  guardedSql("DELETE FROM core.users WHERE email = :'email';", { email: recipient })
  await page.reload()
  await expect(setup.getByText(en.recipientUnavailable, { exact: true })).toBeVisible()
  await expect(setup.getByText(en.loading, { exact: true })).toHaveCount(0)
  await expect(setup.getByRole('button', { name: en.changeRecipient, exact: true })).toBeEnabled()
  await expectNoAxeViolations(page)

  await page.goto(
    localizedFrontendUrl(m.origins.console, coerceSupportedLocale('ru'), 'organizations')
  )
  await page.setViewportSize({ width: 375, height: 900 })
  await expect(setup.getByText(ru.recipientUnavailable, { exact: true })).toBeVisible()
  await expect(setup.getByLabel(ru.email, { exact: true })).toHaveCount(0)
  await expectNoAxeViolations(page)
  await setup.getByRole('button', { name: ru.changeRecipient, exact: true }).click()
  recipient = 'replacement@e2e.amcore.test'
  await setup.getByLabel(ru.email, { exact: true }).fill(recipient)
  await setup.getByRole('button', { name: ru.continue, exact: true }).click()
  await expect(setup.getByText(ru.unverified, { exact: true })).toBeVisible()
  await expect(setup.getByRole('button', { name: ru.finish, exact: true })).toHaveCount(0)
  await proveSetupMailbox(recipientPage, recipient)
  await setup.getByRole('button', { name: ru.checkEmail, exact: true }).click()
  await expect(setup.getByText(ru.verified, { exact: true })).toBeVisible()
  await setup.getByRole('button', { name: ru.continue, exact: true }).click()
  await expect(setup.getByLabel(ru.name, { exact: true })).toHaveValue('Anna shop')
  await expect(setup.getByLabel(ru.slug, { exact: true })).toHaveValue('anna-shop')
  await setup.getByRole('button', { name: ru.continue, exact: true }).click()
  await expect(setup.getByRole('heading', { name: ru.headings.review })).toBeVisible()
  await page.reload()
  await expect(setup.getByRole('heading', { name: ru.headings.review })).toBeVisible()
  await expect(setup.getByText(recipient, { exact: true })).toBeVisible()
  await expect(setup.getByText('Anna shop', { exact: true })).toBeVisible()
  await expectNoAxeViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // A separate lost-commit-response case retains all authority/state but isolates its source budget.
  resetBrowserProbeDomainBudget()
  const bootstrapPattern = '**/api/organization-establishment/bootstrap'
  await page.route(bootstrapPattern, async (route) => {
    await route.fetch()
    await route.abort()
  })
  await setup.getByRole('button', { name: ru.finish, exact: true }).click()
  await expect(setup.getByText(ru.completedPending, { exact: true })).toBeVisible()
  await expect(setup.getByRole('button', { name: ru.confirmResult, exact: true })).toBeVisible()
  await page.unroute(bootstrapPattern)
  await expect(page.getByRole('link', { name: 'Anna shop', exact: true })).toBeVisible()
  await page.reload()
  await setup.getByRole('button', { name: ru.confirmResult, exact: true }).click()
  await expect(setup.getByRole('heading', { name: ru.states['completed-intact'] })).toBeVisible()
  await expect(setup.getByRole('button', { name: ru.confirmResult, exact: true })).toHaveCount(0)
  await expect(setup.getByRole('button', { name: ru.continue, exact: true })).toHaveCount(0)
  await expect(setup.getByText(ru.verified, { exact: true })).toHaveCount(0)
  await expect(setup.getByText(ru.nextSteps, { exact: true })).toBeVisible()
  expect(
    guardedSql('SELECT count(*) FROM core.org_members WHERE "userId" = :\'id\';', {
      id: preparedOperator.userId,
    }).trim()
  ).toBe('0')
  expect(guardedSql('SELECT count(*) FROM core.organization_bootstrap_results;').trim()).toBe('1')
  await expectNoAxeViolations(page)
  await setup.getByRole('link', { name: ru.openOrganization, exact: true }).click()
  await expect(page.getByText('Anna shop', { exact: true })).toBeVisible()

  await recipientPage.goto(
    localizedFrontendUrl(m.origins.product, coerceSupportedLocale('en'), 'login')
  )
  await recipientPage.getByRole('textbox', { name: login.email, exact: true }).fill(recipient)
  await recipientPage.getByLabel(login.password, { exact: true }).fill(SETUP_PASSWORD)
  await recipientPage.getByRole('button', { name: login.login, exact: true }).click()
  await recipientPage.waitForURL(
    (url) =>
      url.pathname ===
      new URL(localizedFrontendUrl(m.origins.product, coerceSupportedLocale('ru'))).pathname
  )
  await recipientPage.goto(
    localizedFrontendUrl(m.origins.product, coerceSupportedLocale('en'), 'organizations')
  )
  await expect(recipientPage.getByRole('heading', { name: 'Anna shop', exact: true })).toBeVisible()
  await recipientPage.close()
})
