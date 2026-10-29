import { type APIRequestContext, expect, type Page } from '@playwright/test'

import { completeMfaSignIn } from '../shared/mfa-login'
import { activeTarget } from '../support/managed-target.mjs'
import { resetMfaDomainSourceBudgets } from '../support/mfa-domain-fixture.mjs'

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
  await page.goto('/en/register')
  if (options.name) {
    await page.getByLabel(/name/i).fill(options.name)
  }
  await page.getByRole('textbox', { name: /email/i }).fill(email)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  const registration = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/auth/register') && r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: /sign up/i }).click()
  const response = await registration
  if (response.status() !== 201) {
    const body = await response.json().catch(() => ({}))
    throw new Error(
      `Registration fixture rejected: status=${response.status()}, code=${body.errorCode ?? 'none'}, reference=${body.correlationId ?? 'none'}`
    )
  }
  expect(response.status()).toBe(201)
  // Callers may immediately close this context or assign a role to the new account.
  await page.waitForURL(/\/en\/?$/)
}

export async function loginViaUi(
  page: Page,
  email: string,
  options: { mfa?: 'complete' | 'manual' } = {}
): Promise<void> {
  await page.goto('/en/login')
  await page.getByRole('textbox', { name: /email/i }).fill(email)
  await page.getByLabel(/^password$/i).fill(TEST_PASSWORD)
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/auth/login') && r.request().method() === 'POST'
  )
  await page.getByRole('button', { name: /sign in/i }).click()
  if ((await response).status() === 202 && options.mfa !== 'manual')
    await completeMfaSignIn(page, email)
}

/** Sign out through the product shell's account menu (header), the only logout control there. */
export async function signOutViaUi(page: Page): Promise<void> {
  await page.getByRole('button', { name: /account menu/i }).click()
  await page.getByRole('menuitem', { name: /sign out/i }).click()
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
  const bootstrap = await request.post(new URL('/api/auth/browser-context', origin).href, {
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
