import { activeTarget } from '../support/managed-target.mjs'

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
    new RegExp('^' + escapeOrigin(standTarget.origins.product) + '/en/?$')
  )

  const console = await browser.newContext({
    baseURL: `${standTarget.origins.console}`,
    ignoreHTTPSErrors: true,
  })
  const consolePage = await console.newPage()
  const productSessionConsoleAttempt = await productPage.request.get(
    `${standTarget.origins.console}/en`
  )
  expect(productSessionConsoleAttempt.status()).toBe(404)

  await consolePage.goto('/en/login')
  await consolePage.getByLabel(/email/i).fill(email)
  await consolePage.getByLabel(/password/i).fill('Test1234Secure')
  const [deniedLogin] = await Promise.all([
    consolePage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/login' &&
        response.request().method() === 'POST'
    ),
    consolePage.getByRole('button', { name: /sign in/i }).click(),
  ])
  expect(deniedLogin.status()).toBe(403)
  expect(await console.cookies(`${standTarget.origins.console}`)).not.toContainEqual(
    expect.objectContaining({ name: '__Host-amcore_console_session' })
  )

  setSystemRole(email, 'SUPER_ADMIN')
  await consolePage.getByRole('button', { name: /sign in/i }).click()
  await expect(consolePage).toHaveURL(
    new RegExp('^' + escapeOrigin(standTarget.origins.console) + '/en/?$')
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
  expect(redisEntry(productEntries[0])).not.toHaveProperty('audience')
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
  await consolePage.getByRole('button', { name: /sign out/i }).click()
  await expect(consolePage).toHaveURL(
    new RegExp('^' + escapeOrigin(standTarget.origins.console) + '/en/login$')
  )

  const loggedOutAccess = await consolePage.request.get('/api/access')
  expect(loggedOutAccess.status()).toBe(401)

  await product.close()
  await console.close()
})

function escapeOrigin(origin: string): string {
  return origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
