import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createInvitationOperationId, DEFAULT_LOCALE, localizedFrontendUrl } from '@amcore/shared'
import { type APIResponse, expect, request, test } from '@playwright/test'

import { TEST_PASSWORD, uniqueEmail } from '../real-stack/helpers'
import { inviteRecipient, membershipCount } from '../real-stack/invitation-recipient.helpers'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

const cookieName = '__Host-amcore_invite_browser'
function headers(response: APIResponse) {
  // Preserve the actual server's cookie and redirect, without rendering or logging their values.
  return response.headers()
}

test('HTTPS: competing first ingress, current-cookie bootstrap and late overwrite fail closed', async ({
  page,
  context,
}) => {
  const target = activeTarget()
  expect(target.origins.product).toMatch(/^https:/)
  const t = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
  ).invitationRecipient
  const first = await inviteRecipient(uniqueEmail('https-first'))
  const second = await inviteRecipient(uniqueEmail('https-second'))
  const url = (token: string) =>
    localizedFrontendUrl(target.origins.product, DEFAULT_LOCALE, `invite/accept?token=${token}`)
  // Independent HTTP clients avoid APIRequestContext's automatic shared-cookie publication.
  const rawA = await request.newContext({
    proxy: { server: target.relay },
    ignoreHTTPSErrors: true,
  })
  const rawB = await request.newContext({
    proxy: { server: target.relay },
    ignoreHTTPSErrors: true,
  })
  try {
    const [a, b] = await Promise.all([
      rawA.get(url(first.token), { maxRedirects: 0 }),
      rawB.get(url(second.token), { maxRedirects: 0 }),
    ])
    expect(a.status()).toBe(303)
    expect(b.status()).toBe(303)
    expect(headers(a)['set-cookie']).toContain(`${cookieName}=`)
    expect(headers(a)['set-cookie']).not.toMatch(/Domain=/i)
    expect(headers(a)['set-cookie']).toMatch(/Secure/)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const pending = new Promise<void>((resolve) => {
      entered = resolve
    })
    const bootstrapA = new URL(headers(a).location!, target.origins.product).href
    await page.route(bootstrapA, async (route) => {
      entered()
      await held
      await route.continue()
    })
    // Publish each actual ingress cookie explicitly: Playwright does not route redirected requests.
    await context.addCookies((await rawA.storageState()).cookies)
    const firstNavigation = page.goto(bootstrapA)
    await pending
    const tab = await context.newPage()
    await context.addCookies((await rawB.storageState()).cookies)
    await tab.goto(new URL(headers(b).location!, target.origins.product).href)
    await expect(tab.getByRole('heading', { name: t.signInTitle, exact: true })).toBeVisible()
    release()
    await firstNavigation
    await expect(page).toHaveURL(/invite\/unusable/)
    // Once attached, a late competing first response displaces the established flow too.
    const displacedFlow = new URL(tab.url()).pathname.split('/').at(-1)
    await page.unroute(bootstrapA)
    await context.addCookies((await rawA.storageState()).cookies)
    await page.goto(bootstrapA)
    await expect(page.getByRole('heading', { name: t.signInTitle, exact: true })).toBeVisible()
    await tab.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    const stale = await context.request.get(
      new URL(`/api/invitation-flows/${displacedFlow}/context`, target.origins.product).href
    )
    expect(stale.ok()).toBe(false)
    const displacedRead = tab.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/invitation-flows/${displacedFlow}/context`,
      { timeout: 10000 }
    )
    await tab.bringToFront()
    await tab.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    )
    expect((await displacedRead).ok()).toBe(false)
    await expect(tab.getByRole('heading', { name: t.signInTitle, exact: true })).toHaveCount(0)
    const cookies = (await context.cookies(target.origins.product)).filter(
      (c) => c.name === cookieName
    )
    expect(cookies).toHaveLength(1)
    expect(cookies[0]).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/' })
    await context.clearCookies({ name: cookieName })
    expect(
      (await context.cookies(target.origins.product)).filter((c) => c.name === cookieName)
    ).toHaveLength(0)
    expect(
      (
        await context.request.get(
          new URL(`/api/invitation-flows/${displacedFlow}/context`, target.origins.product).href
        )
      ).ok()
    ).toBe(false)
    await tab.close()
  } finally {
    await rawA.dispose()
    await rawB.dispose()
  }
})

test('HTTPS: established-owner independent tabs and replacement session cannot use stale consent or ACK', async ({
  page,
  context,
}) => {
  const target = activeTarget()
  const c = JSON.parse(
    readFileSync(join(target.snapshot, `apps/web/messages/${DEFAULT_LOCALE}.json`), 'utf8')
  )
  const email = uniqueEmail('https-established')
  const first = await inviteRecipient(email)
  const second = await inviteRecipient(email)
  expect(
    (
      await context.request.post(new URL('/api/auth/register', target.origins.product).href, {
        headers: { origin: target.origins.product },
        data: { email, password: TEST_PASSWORD },
      })
    ).status()
  ).toBe(201)
  // This fixture owns only readiness setup, not verification transport (proved separately).
  expect(
    guardedSql('UPDATE core.users SET "emailVerified"=true WHERE "emailCanonical"=:\'email\';', {
      email,
    })
  ).toContain('UPDATE 1')
  await page.goto(
    localizedFrontendUrl(
      target.origins.product,
      DEFAULT_LOCALE,
      `invite/accept?token=${first.token}`
    )
  )
  await expect(
    page.getByRole('heading', {
      name: c.invitationRecipient.consentTitle.replace('{organization}', first.org.name),
      exact: true,
    })
  ).toBeVisible()
  const proof = (await context.cookies(target.origins.product)).find(
    (c) => c.name === cookieName
  )!.value
  const firstFlow = new URL(page.url()).pathname.split('/').at(-1)
  const inspected = await context.request.get(
    new URL(`/api/invitation-flows/${firstFlow}/inspect`, target.origins.product).href
  )
  expect(inspected.ok()).toBe(true)
  const snapshot = await inspected.json()
  const tab = await context.newPage()
  await tab.goto(
    localizedFrontendUrl(
      target.origins.product,
      DEFAULT_LOCALE,
      `invite/accept?token=${second.token}`
    )
  )
  await expect(
    tab.getByRole('heading', {
      name: c.invitationRecipient.consentTitle.replace('{organization}', second.org.name),
      exact: true,
    })
  ).toBeVisible()
  expect(
    (await context.cookies(target.origins.product)).find((c) => c.name === cookieName)!.value
  ).toBe(proof)
  expect(new URL(tab.url()).pathname).not.toBe(new URL(page.url()).pathname)
  expect(
    (
      await context.request.get(
        new URL(`/api/invitation-flows/${firstFlow}/context`, target.origins.product).href
      )
    ).ok()
  ).toBe(true)
  expect(
    (
      await context.request.post(new URL('/api/auth/register', target.origins.product).href, {
        headers: { origin: target.origins.product },
        data: { email: uniqueEmail('https-replacement'), password: TEST_PASSWORD },
      })
    ).status()
  ).toBe(201)
  const rejected = await context.request.post(
    new URL(`/api/invitation-flows/${firstFlow}/accept`, target.origins.product).href,
    {
      headers: { origin: target.origins.product },
      data: {
        binding: snapshot.binding,
        expectedInviteId: snapshot.data.inviteId,
        expectedGeneration: snapshot.data.generation,
        operationId: createInvitationOperationId(),
      },
    }
  )
  expect(rejected.status()).toBe(409)
  expect((await rejected.json()).errorCode).toBe('INVITE_FLOW_CHANGED')
  const ack = await context.request.post(
    new URL(
      `/api/invitation-flows/${firstFlow}/auth-handoffs/${'a'.repeat(22)}/ack`,
      target.origins.product
    ).href,
    { headers: { origin: target.origins.product }, data: { binding: snapshot.binding } }
  )
  expect(ack.status()).toBe(409)
  expect((await ack.json()).errorCode).toBe('INVITE_FLOW_CHANGED')
  const staleRead = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.startsWith(`/api/invitation-flows/${firstFlow}/`) &&
      r.request().method() === 'GET',
    { timeout: 10000 }
  )
  await page.bringToFront()
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  )
  expect((await staleRead).ok()).toBe(false)
  await expect(
    page.getByRole('heading', {
      name: c.invitationRecipient.consentTitle.replace('{organization}', first.org.name),
      exact: true,
    })
  ).toHaveCount(0)
  expect(membershipCount(email, first.org.id)).toBe('0')
  expect(membershipCount(email, second.org.id)).toBe('0')
  await tab.close()
})
