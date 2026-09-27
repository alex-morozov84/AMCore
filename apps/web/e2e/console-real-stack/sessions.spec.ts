import { activeTarget } from '../support/managed-target.mjs'

const standTarget = activeTarget()
import { expect, test } from '@playwright/test'

import { registerViaUi, TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'
import { guardedExec, guardedSql } from '../support/managed-target.mjs'

import { ageSessionLastAuthAt, setSystemRole } from './helpers'

function exec(service: string, args: string[]): string {
  return guardedExec(service, ...args).trim()
}

test('host session helper preserves current UA on actual vault rotation; Sessions revoke requires step-up', async ({
  browser,
}) => {
  const email = uniqueEmail('host-sessions-admin'),
    target = uniqueEmail('host-sessions-target')
  const product = await browser.newContext({
    baseURL: `${standTarget.origins.product}`,
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
  await expect(productPage).toHaveURL(/\/en\/?$/)
  await product.clearCookies()
  await registerViaUi(productPage, target)
  await expect(productPage).toHaveURL(/\/en\/?$/)
  setSystemRole(email, 'SUPER_ADMIN')
  const admin = await browser.newContext({
    baseURL: `${standTarget.origins.console}`,
    ignoreHTTPSErrors: true,
  })
  const page = await admin.newPage()
  await page.goto('/en/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(
    new RegExp('^' + escapeOrigin(standTarget.origins.console) + '/en/?$')
  )
  await page.waitForLoadState('networkidle')
  ageSessionLastAuthAt(email)
  const sid = (await admin.cookies()).find(
    (cookie) => cookie.name === '__Host-amcore_console_session'
  )!.value
  const key = `web:console-session:v1:${sid}`
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0 T011-host-rotation'
  expect(
    exec('redis', [
      'redis-cli',
      'EVAL',
      "local v=cjson.decode(redis.call('GET',KEYS[1]));v.accessTokenExpiresAt=0;redis.call('SET',KEYS[1],cjson.encode(v),'KEEPTTL');return 1",
      '1',
      key,
    ])
  ).toBe('1')
  const targetId = guardedSql(`SELECT id FROM core.users WHERE "emailCanonical" = :'email';`, {
    email: target,
  }).trim()
  const refreshed = await admin.request.get(`/en/users/${targetId}`, {
    headers: { 'User-Agent': ua },
  })
  expect(refreshed.status()).toBe(200)
  expect(
    guardedSql(
      `SELECT s."userAgent" FROM core.sessions s JOIN core.users u ON u.id=s."userId" WHERE u."emailCanonical" = :'email' AND s."revokedAt" IS NULL ORDER BY s."createdAt" DESC LIMIT 1;`,
      { email }
    ).trim()
  ).toBe(ua)
  await page.goto(`/en/users/${targetId}`)
  await expect(page.getByRole('heading', { level: 2, name: /Sessions \(1 total\)/ })).toBeVisible()
  const responses: number[] = []
  page.on('response', (response) => {
    if (response.url().endsWith('/api/auth/step-up')) responses.push(response.status())
  })
  await page.getByRole('button', { name: 'Revoke all sessions', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Revoke all sessions', exact: true })
    .click()
  const stepUp = page.getByRole('dialog', { name: /confirm your password/i })
  await expect(stepUp).toBeVisible()
  await stepUp.getByLabel(/password/i).fill(TEST_PASSWORD)
  await stepUp.getByRole('button', { name: /confirm/i }).click()
  await expect(page.getByText('No active sessions.', { exact: true })).toBeVisible()
  expect(responses).toEqual([204])
  await admin.close()
  await product.close()
})

function escapeOrigin(origin: string): string {
  return origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
