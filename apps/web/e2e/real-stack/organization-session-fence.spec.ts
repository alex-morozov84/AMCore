import { expect, type Page, test } from '@playwright/test'

import { observeContextReads, saveContextDiagnostics } from '../support/context-read-diagnostics'
import { activeTarget } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { browserCredentialRequest, TEST_PASSWORD, uniqueEmail } from './helpers'
import { organizationUi } from './organization-context.helpers'

let phase = 'setup'
let audit: ReturnType<typeof observeContextReads>
test.beforeEach(async ({ page }) => {
  phase = 'setup'
  audit = observeContextReads(page, () => phase)
})
test.afterEach(async ({ page }, info) => {
  await saveContextDiagnostics(info, 'session-fence', {
    ...(await audit()),
    pageClosed: page.isClosed(),
  })
})

async function fixture(page: Page) {
  const origin = activeTarget().origins.product
  const email = uniqueEmail('controlled-fence')
  const registered = await browserCredentialRequest(page.request, '/api/auth/register', {
    headers: { origin },
    data: { email, password: TEST_PASSWORD },
  })
  expect(registered.status()).toBe(201)
  const api = await directApi('auth/login', { email, password: TEST_PASSWORD })
  const organization = await directApi(
    'organizations',
    { name: 'Fence-owned organization' },
    api.accessToken
  )
  const ui = organizationUi()
  await page.goto(ui.path(`/${organization.id}`))
  await expect(page.getByRole('heading', { name: organization.name, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: ui.text('refresh'), exact: true })).toBeEnabled()
  await settle()
  return { origin, email, actor: api.user, organization, ui }
}

async function settle() {
  await expect
    .poll(
      async () =>
        (await audit()).requests.filter((r) => !['finished', 'failed'].includes(r.state)).length
    )
    .toBe(0)
}

async function replace(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  phase = 'credential-dispatch'
  const login = await browserCredentialRequest(page.request, '/api/auth/login', {
    headers: { origin: f.origin },
    data: { email: f.email, password: TEST_PASSWORD },
  })
  expect(login.status()).toBe(200)
  phase = 'credential-published'
  const identity = await page.request.get(new URL('/api/auth/me', f.origin).href)
  expect(identity.status()).toBe(200)
  expect((await identity.json()).user.id).toBe(f.actor.id)
  phase = 'identity-verified'
}

async function terminal(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  await expect(page.getByText(f.ui.text('changedTitle'), { exact: true })).toBeVisible()
  await expect(page.getByText(f.organization.name, { exact: true })).toHaveCount(0)
  await settle()
  phase = 'terminal-changed'
}

test('settled session replacement makes one identity read and no old domain read', async ({
  page,
}) => {
  const f = await fixture(page)
  const baseline = (await audit()).requests.length
  await replace(page, f)
  expect((await audit()).requests.slice(baseline)).toEqual([])
  phase = 'explicit-focus'
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await terminal(page, f)
  const result = await audit()
  expect(result.truncated).toBe(0)
  expect(result.requests.slice(baseline).map((r) => r.route)).toEqual([
    '/api/product-access/bootstrap',
  ])
  expect(result.requests.slice(baseline).map((r) => r.status)).toEqual([200])
})

test('old bootstrap delivered after replacement cannot publish old organization authority', async ({
  page,
}) => {
  const f = await fixture(page)
  const baseline = (await audit()).requests.length
  let oldReady = false
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let holdNext = true
  await page.route('**/api/product-access/bootstrap', async (route) => {
    const response = await route.fetch()
    if (holdNext) {
      holdNext = false
      expect(response.status()).toBe(200)
      expect((await response.json()).actor.id).toBe(f.actor.id)
      oldReady = true
      await held
    }
    await route.fulfill({ response })
  })
  try {
    phase = 'old-refresh-start'
    await page.getByRole('button', { name: f.ui.text('refresh'), exact: true }).click()
    await expect.poll(() => oldReady).toBe(true)
    await replace(page, f)
    phase = 'old-response-released'
    release()
    await terminal(page, f)
    const result = await audit()
    expect(result.truncated).toBe(0)
    const reads = result.requests.slice(baseline)
    expect(reads.map((r) => r.route)).toEqual([
      '/api/product-access/bootstrap',
      '/api/product-access/organizations/<id>/context',
    ])
    expect(reads.map((r) => r.status)).toEqual([200, 409])
    expect(reads[1]?.errorCode).toBe('CONTEXT_SESSION_CHANGED')
    const before = result.requests.length
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    expect((await audit()).requests).toHaveLength(before)
  } finally {
    release()
  }
})
