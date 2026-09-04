import { expect, test } from '@playwright/test'

/**
 * Track 3 PR1 (`ai/models-talk.md` FINAL PLAN §3) — static browser
 * security-header baseline from `next.config.ts`'s `headers()`. These
 * headers are environment-independent (no per-request nonce), so asserting
 * them against `next dev`'s real HTTP responses is representative of what
 * ships — unlike CSP nonces, which need the standalone/production build to
 * verify meaningfully (see `docs/frontend/testing.md`).
 *
 * Coverage across two different route types deliberately proves the design
 * rationale in `next.config.ts`'s comment: `src/proxy.ts`'s matcher excludes
 * `/api/*`, so only `headers()`'s un-excluded `/(.*)` source reaches both a
 * page route (through the proxy) and a BFF Route Handler (which the proxy
 * never touches).
 */

// Full expected values, not substring checks — a partial assertion (e.g.
// `toContain('camera=()')`) would stay green if a directive were silently
// dropped from `next.config.ts` as long as one other survived. Kept as a
// literal object here (not imported from `next.config.ts`) deliberately:
// the point of this spec is to pin down what a real HTTP response contains,
// independent of the config source that produced it.
const EXPECTED_STATIC_HEADERS = {
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), gyroscope=(), magnetometer=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
} as const

test('a page route response carries the static security headers', async ({ page }) => {
  const response = await page.goto('/en/login')
  expect(response).not.toBeNull()

  const headers = response!.headers()
  for (const [key, value] of Object.entries(EXPECTED_STATIC_HEADERS)) {
    expect(headers[key], `missing/incorrect ${key}`).toBe(value)
  }
})

test('a BFF Route Handler response (outside the proxy matcher) also carries the static security headers', async ({
  request,
}) => {
  // Unauthenticated on purpose: this asserts headers(), not session state.
  // `/api/auth/sessions` is a real Route Handler under `app/api/**`, which
  // `src/proxy.ts`'s matcher explicitly excludes (`api|_next|_vercel|.*\..*`)
  // — if these headers only came from the proxy, this request would not see
  // them.
  const response = await request.get('/api/auth/sessions')

  const headers = response.headers()
  for (const [key, value] of Object.entries(EXPECTED_STATIC_HEADERS)) {
    expect(headers[key], `missing/incorrect ${key}`).toBe(value)
  }
})

test('the pre-existing /sw.js headers are preserved alongside the new static headers', async ({
  request,
}) => {
  const response = await request.get('/sw.js')

  const headers = response.headers()
  expect(headers['service-worker-allowed']).toBe('/')
  expect(headers['cache-control']).toBe('no-cache, no-store, must-revalidate')
  // Same static block as every other route — proves the two `headers()`
  // entries compose rather than the more specific one replacing the other.
  expect(headers['x-frame-options']).toBe('DENY')
})
