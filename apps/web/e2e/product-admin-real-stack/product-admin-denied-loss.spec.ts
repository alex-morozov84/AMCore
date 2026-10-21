import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { directApi } from '../real-stack/credential-containment.helpers'
import { registerViaUi, TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test('later membership loss hides data on refresh/reload and permits independent logout with profile refused', async ({
  browser,
}) => {
  const { product, staff, ports } = (() => {
    const t = activeTarget()
    return { ...t.origins, ports: t.ports }
  })()
  if (!staff) throw new Error('Owned staff fixture required')
  const context = await browser.newContext({ baseURL: product, ignoreHTTPSErrors: true })
  try {
    const page = await context.newPage()
    const buyer = uniqueEmail('denied-buyer')
    await registerViaUi(page, buyer)
    const email = uniqueEmail('denied-staff')
    const member = await directApi('auth/register', { email, password: TEST_PASSWORD })
    const owner = await directApi('auth/register', {
      email: uniqueEmail('denied-owner'),
      password: TEST_PASSWORD,
    })
    const org = await directApi(
      'organizations',
      { name: 'Private removed organization' },
      owner.accessToken
    )
    await directApi('organizations', { name: 'Other authorized organization' }, member.accessToken)
    const memberId = `c${randomUUID().replaceAll('-', '').slice(0, 24)}`
    guardedSql(
      `INSERT INTO core.org_members (id,"userId","organizationId") VALUES (:'member',:'user',:'org');
      INSERT INTO core.member_roles (id,"memberId","roleId") SELECT :'link',:'member',id FROM core.roles WHERE name='ADMIN' AND "isSystem"=true;
      UPDATE core.organizations SET "aclVersion"="aclVersion"+1 WHERE id=:'org';`,
      {
        member: memberId,
        user: member.user.id,
        org: org.id,
        link: `c${randomUUID().replaceAll('-', '').slice(0, 24)}`,
      }
    )
    await page.goto(`${staff}/en/login`)
    await page.getByRole('textbox', { name: /email/i }).fill(email)
    await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL((url) => url.origin === staff && url.pathname === '/en/organizations')
    const deep = `${staff}/en/organizations/${org.id}/members`
    await page.goto(deep)
    await expect(
      page.getByRole('heading', { name: 'Private removed organization', exact: true })
    ).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible()
    const removed = await fetch(
      `http://127.0.0.1:${ports.api}/api/v1/organizations/${org.id}/members/${member.user.id}?expectedMemberId=${memberId}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${owner.accessToken}` } }
    )
    expect(removed.status).toBe(204)
    // Existing focus activation refreshes authority without replaying a mutation.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const denied = page.getByRole('heading', { name: 'Page unavailable', exact: true })
    await expect(denied).toBeVisible()
    await expect(page.getByText('Private removed organization', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByText('Other authorized organization', { exact: true })).toHaveCount(0)
    expect(page.url()).toBe(deep)
    let profileRefusals = 0
    await page.route(
      (url) => url.origin === staff && url.pathname === '/api/auth/me',
      async (route) => {
        profileRefusals++
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
      }
    )
    await page.reload()
    await expect(denied).toBeVisible()
    await expect(page.getByText('Private removed organization', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('table')).toHaveCount(0)
    expect(await page.evaluate(async () => (await fetch('/api/auth/me')).status)).toBe(503)
    expect(profileRefusals).toBeGreaterThan(0)
    const logout = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/product-admin/auth/logout'
    )
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    expect((await logout).status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
    const buyerMe = await context.request.get(`${product}/api/auth/me`)
    expect(buyerMe.status()).toBe(200)
    expect((await buyerMe.json()).user.email).toBe(buyer)
  } finally {
    await context.close()
  }
})
