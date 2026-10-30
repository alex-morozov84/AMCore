import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl, SUPPORTED_LOCALES } from '@amcore/shared'
import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from '../shared/axe'
import { completeMfaSignIn, completeMfaStepUp } from '../shared/mfa-login'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'
import { proveSetupMailbox, SETUP_PASSWORD, setupCommand } from '../support/organization-setup'
import { openSecretMail } from '../support/secret-mail'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('operator recovery and verification use real localized website mail with safe lost-response recovery', async ({
  page,
  browser,
}) => {
  test.setTimeout(240000)
  page.setDefaultTimeout(15000)
  page.setDefaultNavigationTimeout(20000)
  const m = activeTarget()
  if (
    !['support-mail-path', 'support-mail-host'].includes(m.fixtureProfile ?? '') ||
    !m.origins.staff
  )
    throw new Error('Owned support-mail topology required')
  const copy = (locale: string) =>
    JSON.parse(readFileSync(join(m.snapshot, `apps/web/messages/${locale}.json`), 'utf8'))
  const baseLocale = DEFAULT_LOCALE
  const recipientLocale = SUPPORTED_LOCALES.at(-1) ?? DEFAULT_LOCALE
  const operatorLocale = m.consoleTopology === 'host' ? baseLocale : recipientLocale
  const loginCopy = copy(baseLocale)
  const operatorCopy = copy(operatorLocale)
  const recipientCopy = copy(recipientLocale)
  const t = operatorCopy.console.supportMail
  const product = m.origins.product,
    consoleOrigin = m.origins.console ?? product
  const consolePath = m.consoleTopology === 'host' ? '' : `/${m.consoleSlug}`
  const consoleApi = m.consoleTopology === 'host' ? '/api' : '/api/console'
  const operator = 'support-operator@e2e.amcore.test',
    recipient = 'support-recipient@e2e.amcore.test'
  const prepared = setupCommand('prepare-account', { email: operator, locale: baseLocale })
  await proveSetupMailbox(page, operator)
  const target = randomUUID(),
    passwordless = randomUUID()
  guardedSql("UPDATE core.users SET \"systemRole\"='SUPER_ADMIN' WHERE id=:'id';", {
    id: prepared.userId,
  })
  guardedSql(
    `INSERT INTO core.users (id,email,"emailCanonical",name,"passwordHash",locale,"updatedAt")
    SELECT :'target',:'recipient',:'recipient','Support recipient',"passwordHash",:'recipient_locale',now() FROM core.users WHERE id=:'operator';
    INSERT INTO core.users (id,email,"emailCanonical",name,locale,"updatedAt")
    VALUES (:'passwordless','support-passwordless@e2e.amcore.test','support-passwordless@e2e.amcore.test','Passwordless recipient',:'recipient_locale',now());`,
    {
      target,
      recipient,
      operator: prepared.userId,
      passwordless,
      recipient_locale: recipientLocale,
    }
  )

  await page.goto(localizedFrontendUrl(consoleOrigin, baseLocale, 'login'))
  await page.getByLabel(loginCopy.auth.email, { exact: true }).fill(operator)
  await page.getByLabel(loginCopy.auth.password, { exact: true }).fill(SETUP_PASSWORD)
  const signIn = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/auth/login') && r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: loginCopy.auth.login, exact: true }).click()
  if ((await signIn).status() === 202) await completeMfaSignIn(page, operator)
  await page.waitForURL((url) => url.origin === consoleOrigin && !url.pathname.endsWith('/login'))
  await page.goto(
    localizedFrontendUrl(consoleOrigin, operatorLocale, `${consolePath}/users/${target}`)
  )
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: t.title, exact: true }) })
  await expect(
    card.getByRole('button', { name: t.password_recovery.button, exact: true })
  ).toBeEnabled()
  await expectNoAxeViolations(page)
  const dialog = page.locator('[data-slot="dialog-content"]')
  const confirm = page.getByRole('alertdialog')
  await card.getByRole('button', { name: t.password_recovery.button, exact: true }).click()
  await expect(confirm.getByText(recipient, { exact: false })).toBeVisible()
  await confirm.getByRole('button', { name: t.cancel, exact: true }).click()
  expect(
    guardedSql('SELECT count(*) FROM core.password_reset_tokens WHERE "userId"=:\'id\';', {
      id: target,
    }).trim()
  ).toBe('0')

  // A stale session must reauthenticate; cancelling it never starts transport.
  guardedSql(
    'UPDATE core.auth_session_families SET "primaryAt"=now()-interval \'1 day\', "mfaAt"=now()-interval \'1 day\' WHERE "userId"=:\'id\';',
    { id: prepared.userId }
  )
  await card.getByRole('button', { name: t.email_verification.button, exact: true }).click()
  await confirm.getByRole('button', { name: t.send, exact: true }).click()
  await expect(
    dialog.getByRole('heading', { name: operatorCopy.console.stepUpTitle, exact: true })
  ).toBeVisible()
  await dialog.getByRole('button', { name: operatorCopy.common.close, exact: true }).click()
  expect(
    guardedSql('SELECT count(*) FROM core.email_verification_tokens WHERE "userId"=:\'id\';', {
      id: target,
    }).trim()
  ).toBe('0')
  await card.getByRole('button', { name: t.email_verification.button, exact: true }).click()
  await confirm.getByRole('button', { name: t.send, exact: true }).click()
  await dialog
    .getByLabel(operatorCopy.console.loginPassword, { exact: true })
    .fill('IncorrectPassword123!')
  await dialog.locator('button[type="submit"]').click()
  await expect(
    dialog.getByText(operatorCopy.errors.INVALID_CREDENTIALS, { exact: true })
  ).toBeVisible()
  expect(
    guardedSql('SELECT count(*) FROM core.email_verification_tokens WHERE "userId"=:\'id\';', {
      id: target,
    }).trim()
  ).toBe('0')
  await dialog.getByLabel(operatorCopy.console.loginPassword, { exact: true }).fill(SETUP_PASSWORD)
  await dialog.locator('button[type="submit"]').click()
  await completeMfaStepUp(page, operator)
  await expect(card.getByText(t.summary.accepted, { exact: true })).toBeVisible()
  await expect(page.getByText(t.toast.accepted, { exact: true })).toBeVisible()
  await expect(dialog).toHaveCount(0)

  const recipientContext = await browser.newContext({
    baseURL: product,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  })
  let recipientStage = 'open verification mail'
  try {
    const recipientPage = await recipientContext.newPage()
    recipientPage.setDefaultTimeout(15000)
    recipientPage.setDefaultNavigationTimeout(20000)
    await openSecretMail(recipientPage, recipient, 'verify-email')
    expect(await recipientPage.evaluate(() => location.pathname)).toBe(
      new URL(localizedFrontendUrl(product, recipientLocale, 'verify-email')).pathname
    )
    await expect(
      recipientPage.getByText(recipientCopy.auth.verifyEmailSuccess, { exact: true })
    ).toBeVisible()
    recipientStage = 'recipient sign-in'
    await recipientPage.goto(localizedFrontendUrl(product, recipientLocale, 'login'))
    await recipientPage.getByLabel(recipientCopy.auth.email, { exact: true }).fill(recipient)
    await recipientPage
      .getByLabel(recipientCopy.auth.password, { exact: true })
      .fill(SETUP_PASSWORD)
    await recipientPage.getByRole('button', { name: recipientCopy.auth.login, exact: true }).click()
    await recipientPage.waitForURL((url) => !url.pathname.endsWith('/login'))
    expect(
      guardedSql('SELECT count(*) FROM core.sessions WHERE "userId"=:\'id\';', {
        id: target,
      }).trim()
    ).toBe('1')

    // The actual POST reaches the server once; its success acknowledgment is replaced with 502.
    recipientStage = 'recover lost send response'
    await page.evaluate(() => {
      const original = window.fetch.bind(window)
      const observations = { posts: 0, reads: 0 }
      Object.assign(window, { supportMailObservations: observations })
      window.fetch = async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          location.origin
        )
        const support = url.pathname.includes('/support-mail/')
        const send = support && url.pathname.endsWith('/send') && init?.method === 'POST'
        if (send) observations.posts++
        else if (support && (init?.method ?? 'GET') === 'GET') observations.reads++
        const response = await original(input, init)
        return send && response.ok ? new Response('{}', { status: 502 }) : response
      }
    })
    await card.getByRole('button', { name: t.password_recovery.button, exact: true }).click()
    await confirm.getByRole('button', { name: t.send, exact: true }).click()
    await expect(card.getByText(t.summary.accepted, { exact: true })).toHaveCount(2)
    const observed = await page.evaluate(
      () =>
        (window as unknown as { supportMailObservations: { posts: number; reads: number } })
          .supportMailObservations
    )
    expect(observed.posts).toBe(1)
    expect(observed.reads).toBeGreaterThan(0)
    recipientStage = 'open recovery mail'
    await openSecretMail(recipientPage, recipient, 'reset-password')
    recipientStage = 'submit new password'
    expect(await recipientPage.evaluate(() => location.pathname)).toBe(
      new URL(localizedFrontendUrl(product, recipientLocale, 'reset-password')).pathname
    )
    await recipientPage
      .getByLabel(recipientCopy.auth.newPassword, { exact: true })
      .fill('RecipientChanged123!')
    await recipientPage
      .getByRole('button', { name: recipientCopy.auth.resetPasswordSubmit, exact: true })
      .click()
    await expect(
      recipientPage.getByText(recipientCopy.auth.resetPasswordSuccess, { exact: true })
    ).toBeVisible()
    expect(
      guardedSql('SELECT count(*) FROM core.sessions WHERE "userId"=:\'id\';', {
        id: target,
      }).trim()
    ).toBe('0')
    // A previously issued access JWT retains its lifetime; prove ordinary login without it.
    recipientStage = 'sign in with new password'
    await recipientContext.clearCookies()
    await recipientPage.goto(localizedFrontendUrl(product, recipientLocale, 'login'))
    await recipientPage.getByLabel(recipientCopy.auth.email, { exact: true }).fill(recipient)
    await recipientPage
      .getByLabel(recipientCopy.auth.password, { exact: true })
      .fill('RecipientChanged123!')
    await recipientPage.getByRole('button', { name: recipientCopy.auth.login, exact: true }).click()
    await recipientPage.waitForURL((url) => !url.pathname.endsWith('/login'))
  } catch {
    throw new Error(
      `Recipient mail completion failed at ${recipientStage}; secret diagnostics discarded`
    )
  } finally {
    await recipientContext.close().catch(() => undefined)
  }

  await page.reload()
  await expect(card.getByText(t.summary.accepted, { exact: true })).toHaveCount(2)
  await card
    .getByRole('button', {
      name: t.detailsLabel.replace('{kind}', t.password_recovery.title),
      exact: true,
    })
    .click()
  await expect(
    dialog.getByRole('heading', { name: t.outcomeTitle.accepted, exact: true })
  ).toBeVisible()
  await expectNoAxeViolations(page)
  await dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole('button', { name: t.close, exact: true })
    .click()
  await page.goto(
    localizedFrontendUrl(consoleOrigin, operatorLocale, `${consolePath}/users/${passwordless}`)
  )
  await expect(
    card.getByRole('button', { name: t.password_recovery.button, exact: true })
  ).toBeDisabled()
  await expect(card.getByText(t.unavailable.no_password, { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 375, height: 900 })
  await expectNoAxeViolations(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const foreign = await page.request.post(
    `${consoleOrigin}${consoleApi}/users/${target}/support-mail/prepare`,
    { headers: { Origin: 'https://untrusted.example.test' }, data: { kind: 'password_recovery' } }
  )
  expect(foreign.status()).toBe(403)
  if (m.consoleTopology === 'host') {
    const sibling = await page.request.post(
      `${consoleOrigin}${consoleApi}/users/${target}/support-mail/prepare`,
      { headers: { Origin: m.origins.staff }, data: { kind: 'password_recovery' } }
    )
    expect(sibling.status()).toBe(403)
  }
  expect(
    (await page.request.get(`${m.origins.staff}/api/console/users/${target}/support-mail`)).status()
  ).toBe(404)

  guardedSql(
    `UPDATE core.auth_session_families SET "primaryAt"=now()-interval '1 day', "mfaAt"=now()-interval '1 day' WHERE "userId"=:'id';
    UPDATE core.users SET "passwordHash"=NULL WHERE id=:'id';`,
    { id: prepared.userId }
  )
  await card.getByRole('button', { name: t.email_verification.button, exact: true }).click()
  await confirm.getByRole('button', { name: t.send, exact: true }).click()
  await dialog.getByLabel(operatorCopy.console.loginPassword, { exact: true }).fill(SETUP_PASSWORD)
  await dialog.locator('button[type="submit"]').click()
  await expect(
    dialog.getByText(operatorCopy.errors.STEP_UP_METHOD_UNAVAILABLE, { exact: true })
  ).toBeVisible()
  await expect(dialog.locator('button[type="submit"]')).toHaveCount(0)
  expect(
    guardedSql('SELECT count(*) FROM core.email_verification_tokens WHERE "userId"=:\'id\';', {
      id: passwordless,
    }).trim()
  ).toBe('0')
})
