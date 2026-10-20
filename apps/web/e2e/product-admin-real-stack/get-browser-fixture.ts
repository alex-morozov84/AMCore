import type { BrowserContext } from '@playwright/test'

/** Owned provider transport; API state, PKCE, profile and session handling remain real. */
export async function getBrowserFixture(
  context: BrowserContext,
  origin: string,
  email: string,
  provider: 'google' | 'github',
  surface: 'site' | 'admin',
  link = false
) {
  const base = surface === 'admin' ? '/api/product-admin/auth/oauth' : '/api/auth/oauth'
  const authorization =
    provider === 'google'
      ? new URL('https://accounts.google.com/o/oauth2/v2/auth')
      : new URL('https://github.com/login/oauth/authorize')
  const start = `${base}/${provider}${link ? '/link' : ''}`
  let seen = false
  await context.route(
    (url) => url.origin === origin && url.pathname === start,
    async (route) => {
      const response = await route.fetch({ maxRedirects: 0 })
      const target = new URL(response.headers().location)
      if (
        response.status() !== 302 ||
        target.origin !== authorization.origin ||
        target.pathname !== authorization.pathname
      )
        throw new Error('Unexpected GET provider authorization redirect')
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>location.assign(${JSON.stringify(target.href)})</script></body></html>`,
      })
    }
  )
  await context.route(
    (url) => url.origin === authorization.origin && url.pathname === authorization.pathname,
    async (route) => {
      const params = new URL(route.request().url()).searchParams
      const redirectUri = params.get('redirect_uri')
      const state = params.get('state')
      const challenge = params.get('code_challenge')
      if (
        redirectUri !== `${origin}${base}/${provider}/callback` ||
        !state ||
        !challenge ||
        params.get('code_challenge_method') !== 'S256'
      )
        throw new Error('Unexpected selected GET provider callback or PKCE')
      seen = true
      const target = new URL(redirectUri)
      target.searchParams.set('state', state)
      target.searchParams.set(
        'code',
        Buffer.from(JSON.stringify({ email, redirectUri, challenge })).toString('base64url')
      )
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><script>location.assign(${JSON.stringify(target.href)})</script></body></html>`,
      })
    }
  )
  return () => seen
}
