import { test as proxyTest } from 'next/experimental/testmode/playwright/msw'
import { expect } from '@playwright/test'
import { http, HttpResponse } from 'msw'

const upstream = 'http://api.mocked.invalid/api/v1/auth'

interface AuthMocks {
  providers: (providers: string[]) => void
  hits: { providers: number; signup: number }
}

/** Per-test handler evidence: UI fallback cannot turn an unhandled request into success. */
export const test = proxyTest.extend<{
  authMocks: AuthMocks
  oauthProvidersDefault: boolean
}>({
  oauthProvidersDefault: [true, { option: true }],
  authMocks: [
    async ({ msw, page, baseURL, oauthProvidersDefault }, use) => {
      const hits = { providers: 0, signup: 0 }
      const unexpected: string[] = []
      let needsAuth = false
      page.on('request', (request) => {
        if (
          request.isNavigationRequest() &&
          /\/(?:[^/]+\/)?(?:login|register)$/.test(new URL(request.url()).pathname)
        )
          needsAuth = true
      })
      // Later specific handlers take precedence over this fail-closed fallback.
      msw.use(
        http.all('*', ({ request }) => {
          unexpected.push(`${request.method} ${request.url}`)
          return HttpResponse.json({ error: 'Unexpected upstream request' }, { status: 500 })
        })
      )
      const providers = (configured: string[]) =>
        msw.use(
          http.get(`${upstream}/oauth/providers`, () => {
            hits.providers++
            return HttpResponse.json({ providers: configured })
          })
        )
      msw.use(
        http.get(`${upstream}/signup-policy`, () => {
          hits.signup++
          return HttpResponse.json({ publicSignupEnabled: true })
        })
      )
      if (oauthProvidersDefault) providers([])
      if (!baseURL) throw new Error('Managed auth tests require baseURL')
      const productOrigin = new URL(baseURL).origin
      await page.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin !== productOrigin) {
          unexpected.push(`browser ${route.request().url()}`)
          await route.abort()
        } else await route.fallback()
      })
      await use({ providers, hits })
      expect(unexpected, 'Unexpected external/upstream request').toEqual([])
      if (needsAuth) {
        expect(hits.providers, 'OAuth provider handler must handle the request').toBeGreaterThan(0)
        expect(hits.signup, 'Signup policy handler must handle the request').toBeGreaterThan(0)
      }
    },
    { auto: true },
  ],
})
