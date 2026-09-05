import { CSP_REPORT_ENDPOINT_PATH, CSP_REPORTING_GROUP_NAME } from './constants'

export interface BuildCspDirectivesOptions {
  /** Per-request nonce from {@link import('./generate-nonce').generateNonce}. */
  nonce: string
  /** `process.env.NODE_ENV === 'development'` at the call site. */
  isDev: boolean
}

/**
 * Builds the AMCore CSP directive string (Track 3, `ai/models-talk.md`
 * FINAL PLAN §3 PR2). Pure and environment-read-free by design — the
 * caller decides `isDev` and the header name (enforcing vs
 * `-Report-Only`) — so this is trivially unit-testable without mocking
 * `process.env`.
 *
 * `script-src` is nonce + `'strict-dynamic'`: the only mechanism that
 * actually restricts script execution for Next App Router (its RSC Flight
 * payload is always emitted as an inline `<script>`, and Next's
 * experimental SRI support only covers external bootstrap/preinit files,
 * never that inline payload — verified against the installed
 * `required-scripts.js` source, contradicting the Next docs' own "SRI lets
 * you keep static generation with a strict CSP" framing for this specific
 * case). `'unsafe-eval'` is dev-only: React reconstructs server error
 * stacks via `eval` in development, never in production.
 *
 * `style-src-elem` is nonce-based (Base UI's `CSPProvider` threads the same
 * nonce to the handful of components that render inline `<style>`
 * elements — `ScrollArea.Viewport`, `Select.Popup`/`Select.List` with
 * `alignItemWithTrigger` — none of which `shared/ui` currently uses).
 * `style-src-attr` stays `'unsafe-inline'` deliberately: `shared/ui/sidebar.tsx`
 * renders three intentional `style={...}` CSS-custom-property attributes in
 * SSR'd dashboard HTML, and Base UI's own CSP docs note `style-src-attr`
 * covers a materially smaller attack surface than `style-src-elem`/`script-src`
 * (inline *attributes* on elements the page's own markup already controls,
 * not arbitrary injected `<style>`/`<script>` elements). Tightening this
 * needs real-browser proof the dashboard has no other such attributes, not
 * an assumption — left as a documented follow-up rather than silently
 * promised.
 */
export function buildCspDirectives({ nonce, isDev }: BuildCspDirectivesOptions): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    // Covers both public/sw.js (2.11) and any future Web Worker.
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Complements next.config.ts's X-Frame-Options: DENY (PR1) for
    // CSP-aware browsers; kept in sync deliberately rather than only
    // relying on the legacy header.
    `frame-ancestors 'none'`,
    ...(isDev ? [] : [`upgrade-insecure-requests`]),
    // Track 3 PR3: both delivery mechanisms point at the same endpoint.
    // `report-uri` (CSP Level 2, deprecated but broadly supported) and
    // `report-to` (current Reporting API, needs the `Reporting-Endpoints`
    // response header — set alongside this header in src/proxy.ts) so a
    // browser using either one still reaches
    // `app/api/csp-report/route.ts`.
    `report-uri ${CSP_REPORT_ENDPOINT_PATH}`,
    `report-to ${CSP_REPORTING_GROUP_NAME}`,
  ]
  return directives.join('; ') + ';'
}
