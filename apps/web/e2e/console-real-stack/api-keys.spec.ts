import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { getUserId, setSystemRole } from '../real-stack/admin-helpers'
import { registerViaUi, TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

test('key controls use the isolated Console host and exact origin with live admission', async ({
  browser,
}) => {
  const target = activeTarget()
  const product = await browser.newContext({
    baseURL: target.origins.product,
    ignoreHTTPSErrors: true,
  })
  const console = await browser.newContext({
    baseURL: target.origins.console,
    ignoreHTTPSErrors: true,
  })
  try {
    const email = uniqueEmail('host-keys'),
      productPage = await product.newPage()
    await registerViaUi(productPage, email)
    setSystemRole(email, 'SUPER_ADMIN')
    const userId = getUserId(email),
      organizationId = randomUUID(),
      id = `c${randomUUID().replaceAll('-', '').slice(0, 24)}`
    guardedSql(
      `INSERT INTO core.organizations (id,name,slug,"updatedAt") VALUES (:'org','Host key fixture',:'org',now());
      INSERT INTO core.api_keys (id,name,"shortToken","keyHash",salt,scopes,"userId","organizationId") VALUES (:'id','Host integration',:'id','fake-verifier','fake-salt',ARRAY['read:User'],:'user',:'org');`,
      { org: organizationId, id, user: userId }
    )
    const page = await console.newPage()
    await page.goto('/en/login')
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(TEST_PASSWORD)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).toHaveURL(`${target.origins.console}/en`)
    await page.goto(`/en/api-keys?id=${id}`)
    await expect(page.getByRole('row').filter({ hasText: 'Host integration' })).toBeVisible()
    const path = `/api/api-keys/${id}`
    const wrongOrigin = await page.request.delete(path, {
      headers: { Origin: target.origins.product },
    })
    expect(wrongOrigin.status()).toBe(403)
    expect(
      (
        await productPage.request.delete(`/api/console/api-keys/${id}`, {
          headers: { Origin: target.origins.product },
        })
      ).status()
    ).toBe(404)
    expect(
      guardedSql(`SELECT count(*) FROM core.api_keys WHERE id=:'id' AND "revokedAt" IS NULL;`, {
        id,
      }).trim()
    ).toBe('1')
    const accepted = await page.request.delete(path, {
      headers: { Origin: target.origins.console },
    })
    expect(accepted.status()).toBe(200)
    expect(accepted.headers()['cache-control']).toBe('private, no-store')
    expect(await accepted.json()).toEqual({ requestedCount: 1, affectedCount: 1 })
    setSystemRole(email, 'USER')
    expect(
      (await page.request.delete(path, { headers: { Origin: target.origins.console } })).status()
    ).toBe(403)
  } finally {
    await console.close()
    await product.close()
  }
})
