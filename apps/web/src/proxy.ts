import createMiddleware from 'next-intl/middleware'

import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  // Match every pathname except the ones that must never be locale-prefixed:
  // Next.js internals, the API proxy rewrite, and any path with a file
  // extension (static assets, `manifest.webmanifest`, `sw.js`, icons).
  // Rewriting those would break asset URLs and the service worker scope.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
