import { expect, test } from '@playwright/test'

/**
 * Track 3 PR3 (`ai/models-talk.md` FINAL PLAN §3) — the minimal CSP
 * reporting endpoint's HTTP contract. The `mocked` lane runs `next dev`
 * with no `REDIS_URL` configured at all (confirmed: neither this lane nor
 * `server-mocked` needs one — see `next.config.ts`'s `testProxy` comment),
 * so `getWebRedisClient()` throws synchronously here rather than timing
 * out — a different, faster path through the same fail-open `catch` than
 * `csp-report-rate-limit.spec.ts`'s "Redis unreachable" case, worth
 * covering separately since it exercises a real dependency-missing
 * condition rather than a mock.
 */

test('accepts a well-formed legacy csp-report and responds 204, even with no Redis configured', async ({
  request,
}) => {
  const response = await request.post('/api/csp-report', {
    headers: { 'Content-Type': 'application/csp-report' },
    data: JSON.stringify({
      'csp-report': {
        'document-uri': 'http://localhost/en/login',
        'violated-directive': 'script-src',
      },
    }),
  })

  expect(response.status()).toBe(204)
})

test('accepts a well-formed reports+json body and responds 204', async ({ request }) => {
  const response = await request.post('/api/csp-report', {
    headers: { 'Content-Type': 'application/reports+json' },
    data: JSON.stringify([
      { type: 'csp-violation', body: { effectiveDirective: 'style-src-elem' } },
    ]),
  })

  expect(response.status()).toBe(204)
})

test('responds 204 without processing an unexpected content-type', async ({ request }) => {
  const response = await request.post('/api/csp-report', {
    headers: { 'Content-Type': 'application/json' },
    data: JSON.stringify({ hello: 'world' }),
  })

  expect(response.status()).toBe(204)
})

test('rejects a method other than POST', async ({ request }) => {
  const response = await request.get('/api/csp-report')
  expect(response.status()).toBe(405)
})

test("the CSP header's report-to group resolves to this endpoint via Reporting-Endpoints", async ({
  request,
}) => {
  const response = await request.get('/en/login')
  const reportingEndpoints = response.headers()['reporting-endpoints']

  expect(reportingEndpoints).toContain('csp-endpoint=')
  expect(reportingEndpoints).toContain('/api/csp-report')

  const csp = response.headers()['content-security-policy-report-only']
  expect(csp).toContain('report-uri /api/csp-report')
  expect(csp).toContain('report-to csp-endpoint')
})
