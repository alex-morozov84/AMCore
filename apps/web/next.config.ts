import path from 'node:path'

import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // Standalone output for Docker
  output: 'standalone',

  // Monorepo root for standalone file tracing — without it Next traces from
  // apps/web and omits the workspace `@amcore/shared` package and the hoisted
  // pnpm store, producing a standalone bundle that cannot resolve them.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),

  // React Compiler (stable in Next.js 16)
  reactCompiler: true,

  // AMCore keeps agent instructions in the root AGENTS.md / CLAUDE.md as the
  // single source of truth (see AGENTS.md). Without this, `next dev` would
  // auto-generate a second, nested apps/web/AGENTS.md / CLAUDE.md the first
  // time it detects an AI coding agent.
  agentRules: false,

  experimental: {
    // Enables Next's first-party Playwright+MSW server-side test fixture
    // (`next/experimental/testmode/playwright/msw`, Track 7 FINAL PLAN §3,
    // `ai/models-talk.md`) — intercepts server-side `fetch` calls the Next
    // server makes to `apps/api` (a boundary browser-side `page.route()`
    // can't reach). `PLAYWRIGHT_TEST_PROXY` is only ever set by
    // `playwright.config.ts`'s `webServer.env`, never by a real dev/prod
    // boot, so this adds no interception surface to the shipped app.
    testProxy: process.env.PLAYWRIGHT_TEST_PROXY === 'true',
  },

  // API proxy to backend: NO `rewrites()` here — Route Handlers under
  // `app/api/**` (four dedicated auth routes + the `[...path]` catch-all,
  // ADR-068) own the entire `/api/*` surface now. An array-form `rewrites()`
  // is checked as `afterFiles` — after static/non-dynamic pages but
  // *before* dynamic routes — so a stale rewrite here would silently
  // shadow the catch-all for any path that isn't one of the few static
  // routes, proxying straight to `apps/api` (missing the `/api/v1` prefix
  // Route Handlers add) instead of ever reaching it. Confirmed live: this
  // exact rewrite previously intercepted `GET /api/auth/me` and returned
  // the backend's raw 404 instead of the BFF's proxied response.

  // Browser security-header baseline (Track 3 PR1, ai/models-talk.md FINAL
  // PLAN §3). Static and environment-independent — no per-request state, so
  // it belongs in `headers()` rather than `src/proxy.ts`. `source: '/(.*)'`
  // is deliberate: `proxy.ts`'s matcher excludes `/api/*`, `_next`,
  // `_vercel`, and any dotted path (see its own comment), so this is the
  // only layer that reaches the BFF's `/api/*` Route Handlers and public
  // static files (including `/sw.js` below) — `headers()` has no such
  // exclusion. CSP itself (nonce-based `script-src`, `frame-ancestors`) is
  // deliberately NOT here: it needs a fresh nonce per request, which only
  // `proxy.ts` can generate — that lands in a later PR of this track.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Fallback referrer policy: send full URL same-origin, origin-only
          // cross-origin, nothing on a downgrade (HTTPS -> HTTP). OWASP's
          // recommended default.
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Stop browsers from MIME-sniffing a response away from the
          // Content-Type the server declared (the classic vector: an
          // uploaded/served file sniffed as HTML/JS instead of its real type).
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Deny browser features AMCore doesn't use. Not an exhaustive
          // enumeration of every Permissions-Policy feature — the well-known
          // sensor/payment/tracking APIs plus both FLoC (`interest-cohort`)
          // and its successor Topics API (`browsing-topics`), since an
          // unrecognized token is simply ignored by browsers that lack it.
          // Extend this if a feature (e.g. `publickey-credentials-get` for
          // WebAuthn/passkeys) is genuinely adopted later.
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), gyroscope=(), magnetometer=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
          },
          // Legacy companion to CSP's `frame-ancestors` (not set until the
          // CSP PR): blocks this origin from being framed by anyone,
          // including same-origin, since AMCore has no legitimate framing
          // use case today. `frame-ancestors` will supersede this for
          // CSP-aware browsers once it ships; kept for browsers that only
          // honour the older header.
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // HSTS: pins this origin to HTTPS-only for 2 years, including
          // subdomains. Deliberately emitted unconditionally rather than
          // gated on `NODE_ENV` — per RFC 6797 §8.1, a user agent MUST
          // ignore the header entirely when it arrives over plain HTTP, so
          // it is a no-op (and harmless) under `next dev`/local HTTP and only
          // takes effect once a deployment actually terminates TLS in front
          // of this origin. No `preload`: that's a domain-wide,
          // effectively-irreversible-for-months commitment (owner decision,
          // `ai/models-talk.md` FINAL PLAN §0.2) — documented as an opt-in
          // hardening step for a production deployment that wants it, not a
          // starter default.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
