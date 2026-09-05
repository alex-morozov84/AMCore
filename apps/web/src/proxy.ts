import type { NextRequest } from 'next/server'
import createMiddleware from 'next-intl/middleware'

import { buildCspDirectives } from '@/shared/lib/csp/build-csp'
import {
  CSP_ENFORCE_HEADER,
  CSP_REPORT_ONLY_HEADER,
  NONCE_REQUEST_HEADER,
} from '@/shared/lib/csp/constants'
import { getCspMode } from '@/shared/lib/csp/csp-mode'
import { generateNonce } from '@/shared/lib/csp/generate-nonce'

import { routing } from './i18n/routing'

const handleI18nRouting = createMiddleware(routing)

/**
 * Track 3 PR2 (`ai/models-talk.md` FINAL PLAN §3) — generates a per-request
 * CSP nonce and composes it with next-intl's locale routing.
 *
 * Mutates `request.headers` **in place** rather than constructing a new
 * `Headers`/`NextRequest` (the shape the installed Next docs' own example
 * uses, and an earlier version of this file matched literally) — deliberate,
 * found by a real regression, not a style preference. `request.headers` is
 * genuinely mutable here, and constructing a fresh `NextRequest` broke
 * `next/experimental/testmode/playwright/msw` (`e2e/server-mocked/oauth-visibility.spec.ts`
 * started failing to intercept `apps/api` fetches once mounted through this
 * proxy): that fixture correlates test-mode state
 * (`apps/web/node_modules/next/dist/experimental/testmode/context.js`, keyed
 * off `next-test-proxy-port`/`next-test-data` request headers) to a specific
 * request identity, and a brand-new `NextRequest` object — despite carrying
 * the same headers — broke that correlation even though header *values*
 * were preserved. Passing the original, mutated `request` straight through
 * fixed it, confirmed by reverting to the new-object form and reproducing
 * the failure. No test-mode-only branch was added: the same code path runs
 * in dev, production, and this test lane.
 *
 * Composition with next-intl, verified against the installed next-intl
 * 4.14.1 source (`dist/esm/production/middleware/middleware.js`): its
 * pass-through/rewrite cases clone `request.headers` themselves
 * (`new Headers(t.headers)`) and forward that clone via
 * `NextResponse.next({ request: { headers } })` /
 * `.rewrite(dest, { request: { headers } })` — Next's own documented
 * mechanism for making proxy-added request headers visible to the renderer
 * (`apps/web/node_modules/next/dist/server/web/spec-extension/response.js`:
 * `handleMiddlewareField`). So mutating the headers on the *same* request
 * object before handing it to next-intl is sufficient — anything added
 * rides along automatically into whatever next-intl renders. Its
 * locale-prefix redirects (`NextResponse.redirect(...)`) never forward
 * request headers at all (no render happens for a 3xx) — nothing to nonce
 * there, but the response still gets the CSP header below for
 * completeness/observability.
 *
 * Framework constraint this exists to satisfy (`ai/models-talk.md` §3):
 * Next reads the nonce from the *request's* `Content-Security-Policy` /
 * `-Report-Only` header, not the response — a response-only CSP would
 * silently leave Next's own inline Flight-payload script unnoned and
 * self-block under enforcement.
 */
export default function proxy(request: NextRequest) {
  const nonce = generateNonce()
  const isDev = process.env.NODE_ENV === 'development'
  const mode = getCspMode()
  const cspHeaderName = mode === 'enforce' ? CSP_ENFORCE_HEADER : CSP_REPORT_ONLY_HEADER
  const cspHeaderValue = buildCspDirectives({ nonce, isDev })

  request.headers.set(NONCE_REQUEST_HEADER, nonce)
  request.headers.set(cspHeaderName, cspHeaderValue)

  const response = handleI18nRouting(request)

  response.headers.set(cspHeaderName, cspHeaderValue)

  return response
}

export const config = {
  // Match every pathname except the ones that must never be locale-prefixed:
  // Next.js internals, the API proxy rewrite, and any path with a file
  // extension (static assets, `manifest.webmanifest`, `sw.js`, icons).
  // Rewriting those would break asset URLs and the service worker scope.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
