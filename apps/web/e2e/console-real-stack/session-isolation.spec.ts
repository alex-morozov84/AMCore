import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'

import { redisEntry, redisKeys, setSystemRole } from './helpers'

test('host session is isolated, origin-guarded, and loses admission after demotion', async ({
  browser,
}) => {
  const email = uniqueEmail('console-session')
  const product = await browser.newContext({
    baseURL: 'https://app.localhost',
    ignoreHTTPSErrors: true,
  })
  const productPage = await product.newPage()
  await registerViaUi(productPage, email)
  await expect(productPage).toHaveURL(/https:\/\/app\.localhost\/en\/?$/)

  const console = await browser.newContext({
    baseURL: 'https://console.localhost',
    ignoreHTTPSErrors: true,
  })
  const consolePage = await console.newPage()
  const productSessionConsoleAttempt = await productPage.request.get('https://console.localhost/en')
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
  expect(await console.cookies('https://console.localhost')).not.toContainEqual(
    expect.objectContaining({ name: '__Host-amcore_console_session' })
  )

  setSystemRole(email, 'SUPER_ADMIN')
  await consolePage.getByRole('button', { name: /sign in/i }).click()
  await expect(consolePage).toHaveURL(/https:\/\/console\.localhost\/en\/?$/)

  const cookies = await console.cookies('https://console.localhost')
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

  const productSessionAttempt = await consolePage.request.get('https://app.localhost/api/auth/me')
  expect(productSessionAttempt.status()).toBe(401)
  const crossOriginLogout = await productPage.request.post(
    'https://console.localhost/api/auth/logout',
    {
      headers: { Origin: 'https://app.localhost' },
    }
  )
  expect(crossOriginLogout.status()).toBe(403)

  setSystemRole(email, 'USER')
  const demotedAccess = await consolePage.request.get('/api/access')
  expect(demotedAccess.status()).toBe(403)
  await consolePage.getByRole('button', { name: /sign out/i }).click()
  await expect(consolePage).toHaveURL(/https:\/\/console\.localhost\/en\/login$/)

  const loggedOutAccess = await consolePage.request.get('/api/access')
  expect(loggedOutAccess.status()).toBe(401)

  await product.close()
  await console.close()
})
