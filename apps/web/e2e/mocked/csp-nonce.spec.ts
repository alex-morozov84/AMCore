import { expect, test } from '@playwright/test'

/**
 * Track 3 PR2 (`ai/models-talk.md` FINAL PLAN §3) — nonce-based CSP,
 * shipped `Report-Only`. Deliberately does NOT assert "zero CSP violations
 * during normal navigation" here: `next dev`/Turbopack's own HMR machinery
 * injects ~130 inline `<style>` tags for CSS hot-reload, a real observed
 * `style-src-elem` violation storm that is 100% dev-tooling noise, absent
 * from the production build (confirmed empirically: 132 vs 0 during PR2's
 * implementation). That check lives in `e2e/real-stack/csp-nonce.spec.ts`
 * instead, against the real standalone server — `ai/STATUS.md` working
 * rule 1 ("verify against the artefact that ships") is exactly why.
 *
 * What *is* safe to assert against `next dev`: the nonce mechanism itself
 * (deterministic, doesn't depend on dev vs. production), fetched as raw
 * HTTP text via the `request` fixture — never `page.content()`, which
 * reflects Chromium's live DOM serialization. Browsers deliberately zero
 * out a rendered element's `nonce` attribute once it's in the document
 * (defense against reading it back via `innerHTML`/XSS), so `page.content()`
 * always reports `nonce=""` regardless of what the server actually sent —
 * observed directly while writing this spec, not assumed.
 */

test('the CSP header is Report-Only by default and carries a fresh nonce', async ({ page }) => {
  const response = await page.goto('/en/login')
  expect(response).not.toBeNull()

  const csp = response!.headers()['content-security-policy-report-only']
  expect(csp).toBeTruthy()
  expect(response!.headers()['content-security-policy']).toBeUndefined()

  const nonceMatch = csp!.match(/'nonce-([^']+)'/)
  expect(nonceMatch).not.toBeNull()
})

test('every inline <script> the server returns carries the CSP nonce, none are bare', async ({
  request,
}) => {
  const response = await request.get('/en/login')
  const csp = response.headers()['content-security-policy-report-only']
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

test('the theme-init script carries the CSP nonce and still applies the theme before paint, no flash', async ({
  page,
  request,
}) => {
  const raw = await request.get('/en/login')
  const csp = raw.headers()['content-security-policy-report-only']
  const nonce = csp!.match(/'nonce-([^']+)'/)?.[1]
  const html = await raw.text()
  expect(html).toContain(`<script nonce="${nonce}">(function(){try{var k=`)

  await page.addInitScript(() => window.localStorage.setItem('amcore-theme', 'dark'))
  await page.goto('/en/login')

  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  expect(isDark).toBe(true)
})

test('a hostile inbound Content-Security-Policy request header cannot override the framework nonce', async ({
  request,
}) => {
  // Agent 2's diff review (ai/models-talk.md) found this: proxy.ts only
  // ever *sets* one of the two CSP header names (whichever `getCspMode()`
  // picks) — `.set()` on the *other* name is a no-op, so a request that
  // already carried it (a stray header, or one injected by a misconfigured
  // edge/proxy in front of this origin) would survive untouched. Next's own
  // nonce extraction (app-render.js) prefers `content-security-policy` over
  // `-report-only` when both are present, so an attacker-controlled
  // `Content-Security-Policy` header would win and get stamped onto every
  // framework-injected script. Reproduced against `next dev` with a plain
  // `curl -H "Content-Security-Policy: script-src 'nonce-attacker'"` before
  // the fix (proxy.ts now deletes both header names before setting the
  // active one); this test pins that fix as a permanent regression guard.
  const response = await request.get('/en/login', {
    headers: { 'Content-Security-Policy': "script-src 'nonce-attacker'" },
  })

  const csp = response.headers()['content-security-policy-report-only']
  const realNonce = csp!.match(/'nonce-([^']+)'/)?.[1]
  expect(realNonce).toBeTruthy()
  expect(realNonce).not.toBe('attacker')

  const html = await response.text()
  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? []
  expect(scriptTags.length).toBeGreaterThan(0)
  expect(scriptTags.some((tag) => tag.includes('nonce="attacker"'))).toBe(false)
  expect(scriptTags.every((tag) => tag.includes(`nonce="${realNonce}"`))).toBe(true)
})

test('a hostile inbound Content-Security-Policy-Report-Only request header cannot override the framework nonce', async ({
  request,
}) => {
  // Same class of gap, the other header name — proves the fix clears both,
  // not just whichever one an earlier draft happened to test.
  const response = await request.get('/en/login', {
    headers: { 'Content-Security-Policy-Report-Only': "script-src 'nonce-attacker2'" },
  })

  const csp = response.headers()['content-security-policy-report-only']
  const realNonce = csp!.match(/'nonce-([^']+)'/)?.[1]
  expect(realNonce).toBeTruthy()
  expect(realNonce).not.toBe('attacker2')

  const html = await response.text()
  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? []
  expect(scriptTags.some((tag) => tag.includes('nonce="attacker2"'))).toBe(false)
  expect(scriptTags.every((tag) => tag.includes(`nonce="${realNonce}"`))).toBe(true)
})

test('a bare, unnoned inline script IS reported as a CSP violation — proves the policy is not vacuous', async ({
  page,
}) => {
  const violations: string[] = []
  await page.exposeFunction('__reportCspViolation', (detail: string) => violations.push(detail))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      // @ts-expect-error -- exposed by exposeFunction above
      window.__reportCspViolation(`${event.violatedDirective}: ${event.blockedURI}`)
    })
  })

  // Inject a bare (no nonce) inline script into the *served HTML itself* —
  // real page content the browser parses — rather than via page.evaluate(),
  // which Chrome's DevTools Protocol execution exempts from CSP entirely
  // (a real, documented Chromium behavior discovered while writing this
  // spec: an earlier version of this test used page.evaluate() +
  // appendChild and never triggered a violation, which proved the
  // injection method wrong, not the policy).
  await page.route('**/en/login', async (route) => {
    const response = await route.fetch()
    const body = await response.text()
    const injected = body.replace(
      '</body>',
      '<script>window.__amcoreCspProbe = true</script></body>'
    )
    await route.fulfill({ response, body: injected })
  })

  await page.goto('/en/login')
  await page.waitForTimeout(300)

  expect(violations.some((v) => v.startsWith('script-src'))).toBe(true)
  // Report-Only never blocks execution — the injected script *did* run.
  // (Enforce mode blocking the same injection is a PR4 concern, tested
  // once AMCore's own default actually flips.)
  expect(
    await page.evaluate(
      () => (window as unknown as { __amcoreCspProbe?: boolean }).__amcoreCspProbe
    )
  ).toBe(true)
})
