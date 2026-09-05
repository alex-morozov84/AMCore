import { expect, test } from '@playwright/test'

import { registerViaUi, uniqueEmail } from './helpers'

/**
 * Track 3 PR2 (`ai/models-talk.md` FINAL PLAN §3) — nonce-based CSP against
 * the real production-mode standalone server (`docker-compose.yml`'s
 * `local-infra` profile), not `next dev`.
 *
 * This lane exists specifically because `next dev`/Turbopack's own HMR
 * machinery injects ~130 inline `<style>` tags for CSS hot-reload — a real,
 * observed `style-src-elem` "violation" storm that is 100% dev-tooling
 * noise, absent from the production build (confirmed by running the same
 * check against both during PR2's implementation: 132 vs 0). Asserting
 * "zero CSP violations" against `next dev` would be a false negative
 * either way — noisy-red on a correct policy, or silently passing if the
 * assertion were loosened to tolerate it, hiding a real future regression.
 * `ai/STATUS.md` working rule 1 ("verify against the artefact that
 * ships") is exactly why this check lives here instead.
 */

test('production build: no CSP violations during normal navigation', async ({ page }) => {
  const violations: string[] = []
  await page.exposeFunction('__reportCspViolation', (detail: string) => violations.push(detail))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      // @ts-expect-error -- exposed by exposeFunction above
      window.__reportCspViolation(`${event.violatedDirective}: ${event.blockedURI}`)
    })
  })

  await page.goto('/en/login')
  await page.waitForLoadState('networkidle')

  expect(violations, `unexpected CSP violations: ${violations.join(', ')}`).toHaveLength(0)
})

test('production build: every inline <script> the server returns carries the CSP nonce', async ({
  request,
}) => {
  const response = await request.get('/en/login')
  const csp =
    response.headers()['content-security-policy-report-only'] ??
    response.headers()['content-security-policy']
  expect(csp).toBeTruthy()

  const nonce = csp!.match(/'nonce-([^']+)'/)?.[1]
  expect(nonce).toBeTruthy()

  const html = await response.text()
  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? []
  expect(scriptTags.length).toBeGreaterThan(0)

  const withoutThisNonce = scriptTags.filter((tag) => !tag.includes(`nonce="${nonce}"`))
  expect(
    withoutThisNonce,
    `bare or mismatched script tags: ${JSON.stringify(withoutThisNonce)}`
  ).toHaveLength(0)
})

test('production build: theme still applies before paint under the real CSP, no flash', async ({
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem('amcore-theme', 'dark'))

  await page.goto('/en/login')

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe(true)
})

test('production build: the authenticated dashboard (sidebar style= attributes included) produces no CSP violations', async ({
  page,
}) => {
  // `shared/ui/sidebar.tsx` renders three deliberate `style={...}` CSS
  // custom-property attributes in SSR'd dashboard HTML (ai/models-talk.md
  // §6.5) — the reason `style-src-attr` stays `'unsafe-inline'` rather than
  // nonce-based. This is the one real-stack check that actually exercises
  // that HTML, which `/en/login` (no sidebar) cannot.
  const violations: string[] = []
  await page.exposeFunction('__reportCspViolation', (detail: string) => violations.push(detail))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      // @ts-expect-error -- exposed by exposeFunction above
      window.__reportCspViolation(`${event.violatedDirective}: ${event.blockedURI}`)
    })
  })

  await registerViaUi(page, uniqueEmail('csp-dashboard'), { name: 'E2E Test' })
  await expect(page).toHaveURL(/\/en\/?$/)
  await page.waitForLoadState('networkidle')

  // Also exercises the mobile Sheet variant (a second, structurally
  // different sidebar render) while we have a real authenticated session.
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: /toggle sidebar/i }).click()
  await page.waitForTimeout(200)

  expect(
    violations,
    `unexpected CSP violations on the dashboard: ${violations.join(', ')}`
  ).toHaveLength(0)
})
