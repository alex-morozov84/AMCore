import { expect, test } from '@playwright/test'

import { directApi, proveOwnedRefresh, rawWebRequest } from './credential-containment.helpers'
import { loginViaUi, registerViaUi, TEST_PASSWORD, uniqueEmail } from './helpers'

const METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']
const DENIED = [
  'Auth/Login',
  'auth/Register',
  'auth/refresh',
  'auth/step-up',
  'Auth/oauth/exchange',
  'auth/OAuth/exchange',
  'auth/%6cogin',
  'organizations/TestID/switch',
  'Organizations/x%2Fy/SWITCH',
]

async function safeJson(response: { json(): Promise<unknown> }) {
  const body = (await response.json()) as Record<string, unknown>
  expect('accessToken' in body || 'refreshToken' in body).toBe(false)
  return body
}

test('generic credential routes deny all exported methods before session work', async ({
  request,
}) => {
  for (const path of DENIED) {
    for (const method of METHODS) {
      const response = await request.fetch(`/api/${path}?probe=1`, { method })
      expect(response.status(), `${method} ${path}`).toBe(404)
      if (method === 'HEAD') expect(await response.text()).toBe('')
      else await safeJson(response)
    }
  }
})

test('dedicated auth owns methods and provider exchange does not fall back', async ({
  request,
}) => {
  for (const path of ['auth/login', 'auth/register']) {
    for (const method of METHODS) {
      if (method === 'POST') continue // Valid success is proved in the next scenario.
      const response = await request.fetch(`/api/${path}`, { method })
      expect(response.status()).toBe(method === 'OPTIONS' ? 204 : 405)
      if (method === 'OPTIONS') expect(response.headers().allow).toContain('POST')
    }
  }
  for (const path of ['auth/oauth/exchange', 'auth/oauth/EXCHANGE', 'auth/oauth/%65xchange']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await request.fetch(`/api/${path}`, { method })
      expect(response.status()).toBe(method === 'OPTIONS' ? 204 : 405)
    }
  }
  const slash = await request.post('/api/Auth/Login/', { maxRedirects: 0 })
  expect(slash.status()).toBe(308)
  expect(new URL(slash.headers().location, 'http://fixture').pathname).toBe('/api/Auth/Login')
})

test('raw dot and malformed encoding cannot bypass the boundary', async ({ baseURL }) => {
  if (!baseURL) throw new Error('Credential test requires configured web baseURL')
  for (const path of [
    '/api/x/%2e%2e/auth/login',
    '/api/auth/%2e/login',
    '/api/x/../Auth/Login',
    '/api/../api/Auth/Login',
  ]) {
    const response = await rawWebRequest(baseURL, path)
    expect([400, 404]).toContain(response.status)
    expect(response.body.includes('accessToken') || response.body.includes('refreshToken')).toBe(
      false
    )
  }
  for (const path of ['/api/auth/%', '/api/auth/%GG', '/api/auth/%FF']) {
    const response = await rawWebRequest(baseURL, path)
    // Next dev reports 400; standalone 16.3.5 reports 500 for the same decode failure.
    expect([400, 500]).toContain(response.status)
    expect(response.body.includes('accessToken') || response.body.includes('refreshToken')).toBe(
      false
    )
  }
})

test('user-only auth, authenticated denial, internal refresh and direct org API survive', async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Credential test requires configured web baseURL')
  const context = await browser.newContext({ baseURL })
  const email = uniqueEmail('credential-containment')
  try {
    const page = await context.newPage()
    const pendingRegistration = page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/register') && r.request().method() === 'POST'
    )
    await registerViaUi(page, email, { name: 'Credential fixture' })
    const registration = await pendingRegistration
    expect(registration.status()).toBe(201)
    const registered = await safeJson(registration)
    await expect(page).toHaveURL(/\/en\/?$/)
    await page.getByRole('button', { name: /sign out/i }).click()
    await expect(page).toHaveURL(/\/en\/login/)
    const pendingLogin = page.waitForResponse(
      (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST'
    )
    await loginViaUi(page, email)
    const login = await pendingLogin
    expect(login.status()).toBe(200)
    const { user } = (await safeJson(login)) as { user: { id: string; email: string } }
    expect((registered.user as { id: string }).id).toBe(user.id)
    await expect(page).toHaveURL(/\/en\/?$/)
    await page.close() // No background browser requests during the owned vault CAS.
    const cookie = (await context.cookies()).find(
      (c) => c.name === 'amcore_session' && c.domain === new URL(baseURL).hostname && c.path === '/'
    )
    if (!cookie) throw new Error('Test-created cookie missing')
    await proveOwnedRefresh(cookie.value, user, async () => {
      const me = await context.request.get('/api/auth/me', {
        headers: { cookie: `amcore_session=${cookie.value}` },
      })
      expect(me.status()).toBe(200)
      await safeJson(me)
    })
    const alias = await context.request.post('/api/Auth/Login', { headers: { origin: baseURL } })
    expect(alias.status()).toBe(404)
    await safeJson(alias)
    // Node fetch keeps direct API JWT fixtures out of browser traces.
    const auth = await directApi('auth/login', { email, password: TEST_PASSWORD })
    const org = await directApi(
      'organizations',
      { name: 'Containment fixture', slug: `containment-${Date.now()}` },
      auth.accessToken
    )
    const switched = await directApi(`organizations/${org.id}/switch`, {}, auth.accessToken)
    const read = await directApi(`organizations/${org.id}`, undefined, switched.accessToken)
    expect(read.id).toBe(org.id)
    const denial = await context.request.post(`/api/organizations/${org.id}/switch`, {
      headers: { origin: baseURL },
    })
    expect(denial.status()).toBe(404)
    await safeJson(denial)
  } finally {
    await context.close()
  }
})
