/**
 * Custom request-only header carrying the per-request CSP nonce from
 * `src/proxy.ts` to Server Components. `app/[locale]/layout.tsx` reads it
 * via `headers()` to nonce the theme-init `<script>` and Base UI's
 * `CSPProvider`. Matches Next's own documented convention exactly (see the
 * installed `content-security-policy.md` guide under
 * `apps/web/node_modules/next/dist/docs/`) rather than inventing a
 * different name. Never set on the outgoing response — it has no reason to
 * reach the browser.
 */
export const NONCE_REQUEST_HEADER = 'x-nonce'

/** Enforcing CSP header name. */
export const CSP_ENFORCE_HEADER = 'Content-Security-Policy'

/**
 * Diagnostic CSP header name: browsers report violations without blocking
 * anything. Next's renderer accepts a nonce from either this header or
 * {@link CSP_ENFORCE_HEADER} (verified against the installed
 * `app-render.js` source), so nonce propagation works identically in both
 * modes.
 */
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only'
