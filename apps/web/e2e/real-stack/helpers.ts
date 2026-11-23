import { PRODUCT_ADMIN_CONFIG } from '@amcore/shared'
import { type APIRequestContext, type BrowserContext, expect, type Page } from '@playwright/test'

import { completeMfaSignIn } from '../shared/mfa-login'
import { isProductHome, messages, productPath } from '../shared/product-settings'
import { activeTarget } from '../support/managed-target.mjs'
import {
  resetBrowserProbeDomainBudget,
  resetMfaDomainSourceBudgets,
} from '../support/mfa-domain-fixture.mjs'

/**
 * Real-stack specs register a fresh real account through `apps/api` on
 * every run instead of seeding/cleaning up rows directly — this lane's
 * whole point is exercising the real registration/auth path, and a unique
 * email per run means tests never collide with each other or with a
 * previous run's leftover data. The CI job's Postgres container is
 * ephemeral (destroyed with the job), so there's nothing to clean up
 * there; a persistent local dev database accumulates test accounts the
 * same way any local manual testing would.
 */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.amcore.test`
}

/** Satisfies `registerSchema`: min 8 chars, an uppercase letter, a digit. */
export const TEST_PASSWORD = 'Test1234Secure'

/**
 * `name` is genuinely optional (`registerSchema`, `packages/shared`) — the
 * name field is left blank when `options.name` is omitted, exercising the
 * real optional-field contract end to end. `register-and-logout.spec.ts`
 * does exactly that; the other specs pass a name because filling it isn't
 * what they're testing.
 */
export async function registerViaUi(
  page: Page,
  email: string,
  options: { name?: string } = {}
): Promise<void> {
  resetMfaDomainSourceBudgets()
  resetBrowserProbeDomainBudget()
  await page.goto(productPath('/register'))
  if (options.name) {
    await page.getByLabel(messages.auth.name, { exact: true }).fill(options.name)
  }
  await page.getByRole('textbox', { name: messages.auth.email, exact: true }).fill(email)
  await page.getByLabel(messages.auth.password, { exact: true }).fill(TEST_PASSWORD)
  const registration = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/auth/register') && r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: messages.auth.register, exact: true }).click()
  const response = await registration
  if (response.status() !== 201) {
    const body = await response.json().catch(() => ({}))
    throw new Error(
      `Registration fixture rejected: status=${response.status()}, code=${body.errorCode ?? 'none'}, reference=${body.correlationId ?? 'none'}`
    )
  }
  expect(response.status()).toBe(201)
  // Callers may immediately close this context or assign a role to the new account.
  await page.waitForURL(isProductHome)
}

export async function loginViaUi(
  page: Page,
  email: string,
  options: {
    mfa?: 'complete' | 'manual' | 'required'
    origin?: string
    surface?: 'console'
  } = {}
): Promise<void> {
  await page.goto(
    options.origin ? new URL(productPath('/login'), options.origin).href : productPath('/login')
  )
  const fields =
    options.surface === 'console'
      ? {
          email: messages.console.loginEmail,
          password: messages.console.loginPassword,
          submit: messages.console.signIn,
        }
      : {
          email: messages.auth.email,
          password: messages.auth.password,
          submit: messages.auth.login,
        }
  await page.getByRole('textbox', { name: fields.email, exact: true }).fill(email)
  await page.getByLabel(fields.password, { exact: true }).fill(TEST_PASSWORD)
  const response = page.waitForResponse(
    (r) =>
      (!options.origin || new URL(r.url()).origin === options.origin) &&
      new URL(r.url()).pathname.endsWith('/auth/login') &&
      r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: fields.submit, exact: true }).click()
  const status = (await response).status()
  if (options.mfa === 'required') expect(status).toBe(202)
  if (status === 202 && options.mfa !== 'manual') await completeMfaSignIn(page, email)
}

/** The source mode selects the admitted origin; missing staff transport is never a site fallback. */
export function productAdministrationOrigin(): string {
  const { product, staff } = activeTarget().origins
  if (PRODUCT_ADMIN_CONFIG.mode === 'path') return product
  if (!staff || staff === product)
    throw new Error('Host administration requires its admitted origin')
  return staff
}

/** Registration signs into the site; host administration must establish its own real session. */
export async function ensureAdministrationSession(context: BrowserContext, email: string) {
  if (PRODUCT_ADMIN_CONFIG.mode === 'path') return
  const origin = productAdministrationOrigin()
  const page = await context.newPage()
  try {
    await loginViaUi(page, email, { origin })
    await page.waitForURL(
      (url) =>
        url.origin === origin && !url.pathname.endsWith('/login') && !url.pathname.endsWith('/mfa')
    )
  } catch (error) {
    // Keep the admission failure primary; the owning context still has its teardown.
    await page.close().catch(() => {})
    throw error
  }
  await page.close()
}

/** Sign out through the product shell's account menu (header), the only logout control there. */
export async function signOutViaUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: new RegExp(messages.account.menuLabel) }).click()
  await page.getByRole('menuitem', { name: messages.auth.logout, exact: true }).click()
}

/** Preserve the current-session fence when a fixture signs out without opening the menu. */
export async function logoutViaApi(
  request: APIRequestContext,
  origin: string,
  path = '/api/auth/logout'
) {
  const current = await request.get(new URL('/api/auth/me', origin).href)
  if (current.status() !== 200)
    throw new Error(
      `Current profile refused (${current.status()}): ${JSON.stringify(await probeRefusalEvidence())}`
    )
  const contextSession = current.headers()['x-amcore-context-session']
  expect(contextSession).toBeTruthy()
  const result = await request.post(new URL(path, origin).href, {
    headers: { Origin: origin, 'x-amcore-context-session': contextSession! },
  })
  if (result.status() !== 200)
    throw new Error(
      `Logout refused (${result.status()}): ${JSON.stringify(await probeRefusalEvidence())}`
    )
  return result
}

/** Establish the exact browser attempt before testing a credential endpoint directly. */
export async function postBrowserCredentials(
  request: APIRequestContext,
  origin: string,
  path: string,
  data: Record<string, unknown>
) {
  return browserCredentialRequest(request, path, {
    headers: { Origin: origin },
    data,
  })
}

/** Retain request options while upgrading legacy positive browser fixtures to attempt-bound auth. */
export async function browserCredentialRequest(
  request: APIRequestContext,
  url: string,
  options: NonNullable<Parameters<APIRequestContext['post']>[1]>
) {
  const origin = options.headers?.origin ?? options.headers?.Origin
  if (!origin) throw new Error('Browser credential fixture requires its same-origin header')
  // Direct fixture setup has the same isolation as registerViaUi.
  if (new URL(url, origin).pathname.endsWith('/register')) {
    resetMfaDomainSourceBudgets()
    resetBrowserProbeDomainBudget()
  }
  const staffAuth = new URL(url, origin).pathname.startsWith('/api/product-admin/auth/')
  const bootstrapPath = staffAuth
    ? '/api/product-admin/auth/browser-context'
    : '/api/auth/browser-context'
  const bootstrap = await request.post(new URL(bootstrapPath, origin).href, {
    headers: { Origin: origin },
    data: {},
  })
  expect(bootstrap.status()).toBe(200)
  const { attemptId } = await bootstrap.json()
  expect(typeof attemptId).toBe('string')
  return request.post(new URL(url, origin).href, {
    ...options,
    headers: { ...options.headers, 'x-amcore-login-attempt': attemptId },
  })
}

/** Read-only diagnostics: report only status counts, never metric labels, identities or credentials. */
export async function probeRefusalEvidence() {
  try {
    const target = activeTarget()
    const response = await fetch(`http://127.0.0.1:${target.ports.api}/api/v1/metrics`, {
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return { metricsStatus: response.status }
    const counts: Record<string, number> = {}
    for (const line of (await response.text()).split('\n')) {
      if (
        !line.startsWith('amcore_http_requests_total{') ||
        !line.includes('/auth/browser-publications/probe')
      )
        continue
      const status = /status_code="(\d{3})"/.exec(line)?.[1]
      const value = Number(line.slice(line.lastIndexOf(' ') + 1))
      if (status && Number.isFinite(value)) counts[status] = (counts[status] ?? 0) + value
    }
    return { probeStatusCounts: counts }
  } catch {
    return { metricsUnavailable: true }
  }
}
