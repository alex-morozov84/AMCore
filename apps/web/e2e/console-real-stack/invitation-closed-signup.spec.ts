import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { type APIRequestContext, expect, request, test } from '@playwright/test'

import { getFixtureCallback } from '../product-admin-real-stack/get-browser-fixture'
import { browserCredentialRequest } from '../real-stack/helpers'
import {
  logoutViaApi,
  postBrowserCredentials,
  TEST_PASSWORD,
  uniqueEmail,
} from '../real-stack/helpers'
import { inviteRecipient, membershipCount } from '../real-stack/invitation-recipient.helpers'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

test.skip(
  activeTarget().fixtureProfile !== 'console-closed-signup-oauth',
  'requires:closed-signup-oauth'
)

async function googleCallback(oauth: APIRequestContext, email: string) {
  const target = activeTarget()
  const start = new URL('/api/v1/auth/oauth/google', target.origins.api)
  const authorize = await oauth.get(start.href, { maxRedirects: 0 })
  expect(authorize.status()).toBe(302)
  const location = new URL(authorize.headers().location!)
  expect(location.origin).toBe('https://accounts.google.com')
  const callback = getFixtureCallback(
    location,
    email,
    new URL('/api/auth/oauth/google/callback', target.origins.product).href
  )
  const backend = new URL(start.href + '/callback')
  backend.search = callback.search
  return oauth.get(backend.href, { maxRedirects: 0 })
}

test('deployed closed signup: reject new email/OAuth, allow existing login and invited registration', async ({
  page,
  context,
}) => {
  const target = activeTarget()
  const policy = await context.request.get(
    new URL('/api/v1/auth/signup-policy', target.origins.api).href
  )
  expect(policy.ok()).toBe(true)
  expect((await policy.json()).publicSignupEnabled).toBe(false)
  const c = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
  )
  const email = 'closed-existing@e2e.amcore.test'
  const argon = createRequire(join(target.snapshot, 'apps/api/package.json'))('argon2')
  const hash = await argon.hash(TEST_PASSWORD)
  expect(
    guardedSql(
      `INSERT INTO core.users(id,email,"emailCanonical","emailVerified","passwordHash","updatedAt") VALUES(:'id',:'email',:'email',true,:'hash',now());`,
      { id: randomUUID(), email, hash }
    )
  ).toContain('INSERT 0 1')
  const register = await postBrowserCredentials(
    context.request,
    target.origins.product,
    '/api/auth/register',
    { email: uniqueEmail('closed-email'), password: TEST_PASSWORD }
  )
  expect(register.status()).toBe(403)
  expect((await register.json()).errorCode).toBe('PUBLIC_SIGNUP_DISABLED')
  expect(
    (
      await browserCredentialRequest(
        context.request,
        new URL('/api/auth/login', target.origins.product).href,
        {
          headers: { origin: target.origins.product },
          data: { email, password: TEST_PASSWORD },
        }
      )
    ).status()
  ).toBe(200)
  const oauth = await request.newContext({
    proxy: { server: target.relay },
    ignoreHTTPSErrors: true,
  })
  try {
    const rejected = await googleCallback(oauth, 'closed-oauth-new@e2e.amcore.test')
    expect(rejected.status()).toBe(403)
    expect((await rejected.json()).errorCode).toBe('PUBLIC_SIGNUP_DISABLED')
    expect(
      guardedSql(
        `SELECT count(*) FROM core.users WHERE "emailCanonical"='closed-oauth-new@e2e.amcore.test';`
      ).trim()
    ).toBe('0')
    const existing = await googleCallback(oauth, email)
    expect(existing.status()).toBe(302)
    expect(new URL(existing.headers().location!).pathname).toMatch(/auth\/callback$/)
    expect(new URL(existing.headers().location!).searchParams.has('ticket')).toBe(true)
  } finally {
    await oauth.dispose()
  }
  const invited = uniqueEmail('closed-invited')
  const { org, token } = await inviteRecipient(invited, email)
  await logoutViaApi(context.request, target.origins.product)
  await page.goto(
    localizedFrontendUrl(target.origins.product, DEFAULT_LOCALE, `invite/accept?token=${token}`)
  )
  await page.getByRole('tab', { name: c.auth.register, exact: true }).click()
  await page
    .getByRole('tabpanel', { name: c.auth.register, exact: true })
    .getByLabel(c.auth.password, { exact: true })
    .fill(TEST_PASSWORD)
  await page
    .getByRole('tabpanel', { name: c.auth.register, exact: true })
    .getByRole('button', { name: c.auth.register, exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: c.invitationRecipient.verifyTitle, exact: true })
  ).toBeVisible()
  expect(membershipCount(invited, org.id)).toBe('0')
})
