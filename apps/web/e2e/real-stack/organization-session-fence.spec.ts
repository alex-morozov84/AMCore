import { expect, type Page, test } from '@playwright/test'

import { observeContextReads, saveContextDiagnostics } from '../support/context-read-diagnostics'
import { activeTarget } from '../support/managed-target.mjs'

import { directApi } from './credential-containment.helpers'
import { browserCredentialRequest, TEST_PASSWORD, uniqueEmail } from './helpers'
import { organizationUi } from './organization-context.helpers'

let phase = 'setup'
let phaseStarted = 0
let phaseHistory: Array<{ phase: string; ms: number }> = []
function mark(next: string) {
  phase = next
  if (phaseHistory.length < 16)
    phaseHistory.push({ phase, ms: Math.round(performance.now() - phaseStarted) })
}
let audit: ReturnType<typeof observeContextReads>
test.beforeEach(async ({ page }) => {
  phaseStarted = performance.now()
  phaseHistory = []
  mark('setup')
  audit = observeContextReads(page, () => phase)
})
test.afterEach(async ({ page }, info) => {
  await saveContextDiagnostics(info, 'session-fence', {
    ...(await audit()),
    pageClosed: page.isClosed(),
    phaseHistory,
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
  mark('credential-dispatch')
  const login = await browserCredentialRequest(page.request, '/api/auth/login', {
    headers: { origin: f.origin },
    data: { email: f.email, password: TEST_PASSWORD },
  })
  expect(login.status()).toBe(200)
  mark('credential-published')
  const identity = await page.request.get(new URL('/api/auth/me', f.origin).href)
  expect(identity.status()).toBe(200)
  expect((await identity.json()).user.id).toBe(f.actor.id)
  mark('identity-verified')
}

async function terminal(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  await expect(page.getByText(f.ui.text('changedTitle'), { exact: true })).toBeVisible()
  await expect(page.getByText(f.organization.name, { exact: true })).toHaveCount(0)
  await settle()
  mark('terminal-changed')
}

test('settled session replacement makes one identity read and no old domain read', async ({
  page,
}) => {
  const f = await fixture(page)
  const baseline = (await audit()).requests.length
  await replace(page, f)
  expect((await audit()).requests.slice(baseline)).toEqual([])
  mark('explicit-focus')
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
    mark('old-refresh-start')
    await page.getByRole('button', { name: f.ui.text('refresh'), exact: true }).click()
    await expect.poll(() => oldReady).toBe(true)
    await replace(page, f)
    mark('old-response-released')
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

test('focus retires an already authorized old domain response before it can publish', async ({
  page,
}) => {
  const f = await fixture(page)
  const baseline = (await audit()).requests.length
  let oldReady = false
  let oldFinished = false
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let holdNext = true
  await page.route(
    `**/api/product-access/organizations/${f.organization.id}/context`,
    async (route) => {
      const response = await route.fetch()
      if (holdNext) {
        holdNext = false
        expect(response.status()).toBe(200)
        expect((await response.json()).data.organization.name).toBe(f.organization.name)
        oldReady = true
        await held
      }
      try {
        await route.fulfill({ response })
      } catch {
        expect(route.request().failure()?.errorText).toBe('net::ERR_ABORTED')
      } finally {
        oldFinished = true
      }
    }
  )
  try {
    mark('old-domain-read')
    await page.getByRole('button', { name: f.ui.text('refresh'), exact: true }).click()
    await expect.poll(() => oldReady).toBe(true)
    await replace(page, f)
    mark('focus-with-old-domain')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await terminal(page, f)
    mark('old-domain-release-attempt')
    release()
    await expect.poll(() => oldFinished).toBe(true)
    await terminal(page, f)
    const result = await audit()
    expect(result.truncated).toBe(0)
    const reads = result.requests.slice(baseline)
    expect(reads.map((r) => r.route)).toEqual([
      '/api/product-access/bootstrap',
      '/api/product-access/organizations/<id>/context',
      '/api/product-access/bootstrap',
    ])
    expect(reads[1]?.state).toBe('failed')
    expect(reads[1]?.events.at(-1)?.type).toBe('aborted')
    expect(reads[2]?.status).toBe(200)
  } finally {
    release()
  }
})
