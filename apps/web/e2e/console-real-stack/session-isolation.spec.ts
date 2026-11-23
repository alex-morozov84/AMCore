import { completeMfaSignIn } from '../shared/mfa-login'
import { isProductHome, messages, productPath } from '../shared/product-settings'
import { activeTarget, guardedSql } from '../support/managed-target.mjs'

const standTarget = activeTarget()
import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'

import { redisEntry, redisKeys, setSystemRole } from './helpers'

test('host session is isolated, origin-guarded, and loses admission after demotion', async ({
  browser,
}) => {
  const email = uniqueEmail('console-session')
  const product = await browser.newContext({
    baseURL: `${standTarget.origins.product}`,
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
  await expect(productPage).toHaveURL(
    (url) => url.origin === standTarget.origins.product && isProductHome(url)
  )

  const console = await browser.newContext({
    baseURL: `${standTarget.origins.console}`,
    ignoreHTTPSErrors: true,
  })
  const consolePage = await console.newPage()
  const productSessionConsoleAttempt = await productPage.request.get(
    `${standTarget.origins.console}${productPath().replace(/\/$/, '')}`
  )
  expect(productSessionConsoleAttempt.status()).toBe(404)

  await consolePage.goto(productPath('/login'))
  await consolePage.getByLabel(messages.console.loginEmail, { exact: true }).fill(email)
  await consolePage
    .getByLabel(messages.console.loginPassword, { exact: true })
    .fill('Test1234Secure')
  const [deniedLogin] = await Promise.all([
    consolePage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/login' &&
        response.request().method() === 'POST'
    ),
    consolePage.getByRole('button', { name: messages.console.signIn, exact: true }).click(),
  ])
  expect(deniedLogin.status()).toBe(401)
  expect(await console.cookies(`${standTarget.origins.console}`)).not.toContainEqual(
    expect.objectContaining({ name: '__Host-amcore_console_session' })
  )

  setSystemRole(email, 'SUPER_ADMIN')
  await consolePage.getByRole('button', { name: messages.console.signIn, exact: true }).click()
  await completeMfaSignIn(consolePage, email)
  await expect(consolePage).toHaveURL(
    (url) => url.origin === standTarget.origins.console && isProductHome(url)
  )

  const cookies = await console.cookies(`${standTarget.origins.console}`)
  expect(cookies).toContainEqual(
    expect.objectContaining({
      name: '__Host-amcore_console_session',
      secure: true,
      sameSite: 'Strict',
    })
  )
  const productEntries = redisKeys('web:session:v1')
  const consoleEntries = redisKeys('web:console-session:v1')
  expect(productEntries).not.toHaveLength(0)
  expect(consoleEntries).not.toHaveLength(0)
  expect(redisEntry(productEntries[0])).toMatchObject({ audience: 'product' })
  expect(redisEntry(consoleEntries[0])).toMatchObject({ audience: 'console' })

  const productSessionAttempt = await consolePage.request.get(
    `${standTarget.origins.product}/api/auth/me`
  )
  expect(productSessionAttempt.status()).toBe(401)
  const crossOriginLogout = await productPage.request.post(
    `${standTarget.origins.console}/api/auth/logout`,
    {
      headers: { Origin: `${standTarget.origins.product}` },
    }
  )
  expect(crossOriginLogout.status()).toBe(403)

  setSystemRole(email, 'USER')
  const demotedAccess = await consolePage.request.get('/api/access')
  expect(demotedAccess.status()).toBe(403)
  await consolePage.getByRole('button').filter({ hasText: email }).click()
  await consolePage.getByRole('menuitem', { name: messages.auth.logout, exact: true }).click()
  await expect(consolePage).toHaveURL(
    (url) =>
      url.origin === standTarget.origins.console &&
      url.pathname === productPath('/sign-in-again') &&
      !!url.searchParams.get('entryId') &&
      !!url.searchParams.get('returnEntryId')
  )

  const loggedOutAccess = await consolePage.request.get('/api/access')
  expect(loggedOutAccess.status()).toBe(401)

  await product.close()
  await console.close()
})

test('host MFA reentry retires target reads across browser history and a confirmed session change', async ({
  browser,
}) => {
  const email = uniqueEmail('console-query-reentry')
  const product = await browser.newContext({
    baseURL: standTarget.origins.product,
    ignoreHTTPSErrors: true,
  })
  const registration = await product.newPage()
  await registerViaUi(registration, email)
  setSystemRole(email, 'SUPER_ADMIN')
  const targetId = guardedSql(`SELECT id FROM core.users WHERE "emailCanonical" = :'email';`, {
    email,
  }).trim()
  const operator = await browser.newContext({
    baseURL: standTarget.origins.console,
    ignoreHTTPSErrors: true,
  })
  const page = await operator.newPage()
  const signIn = async () => {
    await page.getByLabel(messages.console.loginEmail, { exact: true }).fill(email)
    await page.getByLabel(messages.console.loginPassword, { exact: true }).fill('Test1234Secure')
    await page.getByRole('button', { name: messages.console.signIn, exact: true }).click()
    await completeMfaSignIn(page, email)
    await expect(page).toHaveURL(
      (url) => url.origin === standTarget.origins.console && isProductHome(url)
    )
  }
  const openTarget = async () => {
    await page.getByRole('link', { name: messages.console.users, exact: true }).first().click()
    await page.getByRole('row').filter({ hasText: email }).getByRole('link').first().click()
    await expect(page).toHaveURL((url) => url.pathname === productPath(`/users/${targetId}`))
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: new RegExp(
          '^' +
            messages.console.userSessionsHeading
              .split('{count}')[0]
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            '[1-9]'
        ),
      })
    ).toBeVisible()
  }
  const sessionFamily = async () => {
    const cookie = (await operator.cookies(standTarget.origins.console)).find(
      (entry) => entry.name === '__Host-amcore_console_session'
    )
    if (!cookie) throw new Error('Confirmed Console cookie missing')
    const entry = redisEntry(`web:console-session:v1:${cookie.value}`)
    const binding = entry.browser as { familyId?: string } | undefined
    if (!binding?.familyId) throw new Error('Confirmed Console family missing')
    return binding.familyId
  }
  try {
    await page.goto(productPath('/login'))
    await signIn()
    const firstFamily = await sessionFamily()
    let reads = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === `/api/users/${targetId}/sessions`) reads++
    })
    await openTarget()
    expect(reads).toBe(1)
    const loadedAt = Date.now()
    await page.evaluate(() => Object.assign(window, { __t093Document: 'retained' }))
    // Select the exact native history entry instead of racing repeated asynchronous Back calls.
    const navigation = await operator.newCDPSession(page)
    const history = await navigation.send('Page.getNavigationHistory')
    const loginEntry = history.entries.find((entry) => {
      const url = new URL(entry.url)
      return url.origin === standTarget.origins.console && url.pathname === productPath('/login')
    })
    expect(!!loginEntry).toBe(true)
    await navigation.send('Page.navigateToHistoryEntry', { entryId: loginEntry!.id })
    await navigation.detach()
    await expect(page).toHaveURL((url) => url.pathname === productPath('/login'))
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__t093Document)
    ).toBe('retained')
    await signIn()
    const secondFamily = await sessionFamily()
    // Never expose the cookie or family identities in assertion output.
    expect(secondFamily === firstFamily).toBe(false)
    await openTarget()
    expect(Date.now() - loadedAt).toBeLessThan(60000)
    expect(reads).toBe(2)
    await page.goBack()
    await expect(page).toHaveURL((url) => url.pathname === productPath('/users'))
    await page.goForward()
    await expect(page).toHaveURL((url) => url.pathname === productPath(`/users/${targetId}`))
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: new RegExp(
          '^' +
            messages.console.userSessionsHeading
              .split('{count}')[0]
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            '[1-9]'
        ),
      })
    ).toBeVisible()
    expect(reads).toBe(2)
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__t093Document)
    ).toBe('retained')
  } finally {
    await operator.close()
    await product.close()
  }
})
