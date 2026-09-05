import { NextRequest } from 'next/server'
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
 * Composition, verified against the installed next-intl 4.14.1 source
 * (`dist/esm/production/middleware/middleware.js`): its pass-through/
 * rewrite cases clone the *incoming* request's headers themselves
 * (`new Headers(t.headers)`) and forward that clone via
 * `NextResponse.next({ request: { headers } })` /
 * `.rewrite(dest, { request: { headers } })` — Next's own documented
 * mechanism for making proxy-added request headers visible to the
 * renderer (`apps/web/node_modules/next/dist/server/web/spec-extension/response.js`:
 * `handleMiddlewareField`). So adding the CSP + nonce headers to the
 * request *before* handing it to next-intl here is sufficient — anything
 * added rides along automatically into whatever next-intl renders. Its
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

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(NONCE_REQUEST_HEADER, nonce)
  requestHeaders.set(cspHeaderName, cspHeaderValue)

  const requestWithCsp = new NextRequest(request, { headers: requestHeaders })
  const response = handleI18nRouting(requestWithCsp)

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
