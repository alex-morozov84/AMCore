import { expect, test } from '@playwright/test'

/**
 * Search-engine indexing is closed by default (docs/frontend/seo.md). The mocked lane never sets
 * `WEB_SEO_INDEXING`, so this asserts the closed state on real HTTP responses from `next dev`:
 * the proxy header on pages, the static header on routes the proxy never sees, the root `noindex`
 * meta tag, and `robots.txt`/`sitemap.xml` for a product with no public pages. The open state and
 * the run-time reading of the two variables are covered by the stand scenario in the task record
 * (a built image started twice with different values), which this lane cannot do.
 */
const NOINDEX = 'noindex, nofollow'

test('a proxied page response is closed to search engines by header', async ({ request }) => {
  const response = await request.get('/en/login')
  expect(response.headers()['x-robots-tag']).toBe(NOINDEX)
})

test('a route outside the proxy matcher still carries the static noindex header', async ({
  request,
}) => {
  // `/api/*` never passes `src/proxy.ts`, so this header can only come from `next.config.ts`.
  const response = await request.get('/api/auth/sessions')
  expect(response.headers()['x-robots-tag']).toBe(NOINDEX)
})

test('a private page is closed by the root noindex meta tag', async ({ page }) => {
  await page.goto('/en/login')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', NOINDEX)
})

test('robots.txt allows crawling without listing any path or sitemap', async ({ request }) => {
  const response = await request.get('/robots.txt')
  expect(response.status()).toBe(200)
  const body = await response.text()
  expect(body).toMatch(/User-Agent: \*/i)
  expect(body).toMatch(/Allow: \//)
  expect(body).not.toMatch(/Disallow|Sitemap|admin|login/i)
})

test('a product with no public pages serves no sitemap', async ({ request }) => {
  const response = await request.get('/sitemap.xml')
  expect(response.status()).toBe(404)
})
