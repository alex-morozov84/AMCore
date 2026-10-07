import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { expect, request, test } from '@playwright/test'

import { TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'
import { inviteRecipient, membershipCount } from '../real-stack/invitation-recipient.helpers'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

test('deployed closed signup: reject new email/OAuth, allow existing login and invited registration', async ({
  page,
  context,
}) => {
  const target = activeTarget()
  const policy = await context.request.get(
    new URL('/api/v1/auth/signup-policy', target.origins.api).href
  )
  expect(policy.ok()).toBe(true)
  const data = await policy.json()
  test.skip(
    data.publicSignupEnabled !== false,
    'Requires isolated closed-policy production fixture; ordinary stands keep signup enabled.'
  )
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
  const register = await context.request.post(
    new URL('/api/auth/register', target.origins.product).href,
    {
      headers: { origin: target.origins.product },
      data: { email: uniqueEmail('closed-email'), password: TEST_PASSWORD },
    }
  )
  expect(register.status()).toBe(403)
  expect((await register.json()).errorCode).toBe('PUBLIC_SIGNUP_DISABLED')
  expect(
    (
      await context.request.post(new URL('/api/auth/login', target.origins.product).href, {
        headers: { origin: target.origins.product },
        data: { email, password: TEST_PASSWORD },
      })
    ).status()
  ).toBe(200)
  const oauth = await request.newContext({
    proxy: { server: target.relay },
    ignoreHTTPSErrors: true,
  })
  try {
    const authorize = await oauth.get(
      new URL('/api/v1/auth/oauth/google', target.origins.api).href,
      { maxRedirects: 0 }
    )
    expect(authorize.status()).toBe(302)
    const state = new URL(authorize.headers().location!).searchParams.get('state')
    const rejected = await oauth.get(
      new URL(`/api/v1/auth/oauth/google/callback?state=${state}&code=new`, target.origins.api)
        .href,
      { maxRedirects: 0 }
    )
    expect(rejected.status()).toBe(403)
    expect((await rejected.json()).errorCode).toBe('PUBLIC_SIGNUP_DISABLED')
    expect(
      guardedSql(
        `SELECT count(*) FROM core.users WHERE "emailCanonical"='closed-oauth-new@e2e.amcore.test';`
      ).trim()
    ).toBe('0')
    const again = await oauth.get(new URL('/api/v1/auth/oauth/google', target.origins.api).href, {
      maxRedirects: 0,
    })
    const existingState = new URL(again.headers().location!).searchParams.get('state')
    const existing = await oauth.get(
      new URL(
        `/api/v1/auth/oauth/google/callback?state=${existingState}&code=existing`,
        target.origins.api
      ).href,
      { maxRedirects: 0 }
    )
    expect(existing.status()).toBe(302)
    expect(new URL(existing.headers().location!).pathname).toMatch(/auth\/callback$/)
    expect(new URL(existing.headers().location!).searchParams.has('ticket')).toBe(true)
  } finally {
    await oauth.dispose()
  }
  const invited = uniqueEmail('closed-invited')
  const { org, token } = await inviteRecipient(invited, email)
  await context.request.post(new URL('/api/auth/logout', target.origins.product).href, {
    headers: { origin: target.origins.product },
  })
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
