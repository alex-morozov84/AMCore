import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from '../real-stack/helpers'

const project = process.env.CONSOLE_E2E_PROJECT ?? 'amcore-console-e2e'

function setSystemRole(email: string, role: 'USER' | 'SUPER_ADMIN'): void {
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      project,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'amcore',
      '-d',
      'amcore',
      '-c',
      `UPDATE core.users SET "systemRole" = '${role}' WHERE "emailCanonical" = '${email}';`,
    ],
    { stdio: 'pipe' }
  )
}

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
  const preLogin = await consolePage.request.get('/en')
  expect(preLogin.status()).toBe(404)

  setSystemRole(email, 'SUPER_ADMIN')
  await consolePage.goto('/en/login')
  await consolePage.getByLabel(/email/i).fill(email)
  await consolePage.getByLabel(/password/i).fill('Test1234Secure')
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
