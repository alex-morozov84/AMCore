import type { BrowserContext } from '@playwright/test'

const html = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

/** Owned E2E transport only; the application callback remains a real cross-site POST. */
export async function appleBrowserFixture(
  context: BrowserContext,
  origin: string,
  email: string,
  automatic = true,
  options: { surface?: 'site' | 'admin'; scenario?: string } = {}
) {
  const base = options.surface === 'site' ? '/api/auth/oauth' : '/api/product-admin/auth/oauth'
  let seen = false
  await context.route(
    (url) => url.origin === origin && url.pathname === `${base}/apple`,
    async (route) => {
      const response = await route.fetch({ maxRedirects: 0 })
      const destination = new URL(response.headers().location)
      if (
        response.status() !== 302 ||
        destination.origin !== 'https://appleid.apple.com' ||
        destination.pathname !== '/auth/authorize'
      )
        throw new Error('Unexpected Apple authorization redirect')
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><body><a href="${html(destination.href)}">Continue to fixture provider</a>${automatic ? `<script>location.assign(${JSON.stringify(destination.href)})</script>` : ''}</body></html>`,
      })
    }
  )
  await context.route('https://appleid.apple.com/auth/authorize**', async (route) => {
    const authorization = new URL(route.request().url())
    const redirectUri = authorization.searchParams.get('redirect_uri')
    if (redirectUri !== `${origin}${base}/apple/callback`)
      throw new Error('Unexpected selected Apple callback')
    const state = authorization.searchParams.get('state')
    const challenge = authorization.searchParams.get('code_challenge')
    if (!state || !challenge) throw new Error('Missing OAuth state or PKCE challenge')
    seen = true
    const fields = {
      state,
      code: Buffer.from(
        JSON.stringify({ email, redirectUri, challenge, scenario: options.scenario ?? 'valid' })
      ).toString('base64url'),
      user: JSON.stringify({ name: { firstName: 'Fixture', lastName: 'Member' } }),
    }
    const inputs = Object.entries(fields)
      .map(([name, value]) => `<input type="hidden" name="${name}" value="${html(value)}">`)
      .join('')
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><form method="post" action="${html(redirectUri)}">${inputs}<button type="submit">Authorize fixture</button></form>${automatic ? '<script>document.forms[0].submit()</script>' : ''}</body></html>`,
    })
  })
  return () => seen
}
