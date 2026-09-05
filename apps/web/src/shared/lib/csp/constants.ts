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

/**
 * Track 3 PR3 (`ai/models-talk.md` FINAL PLAN §3) — minimal CSP violation
 * reporting endpoint. Same-origin Route Handler (`app/api/csp-report/route.ts`),
 * outside `src/proxy.ts`'s matcher (paths starting with `api`), so it needs
 * no nonce and isn't subject to the policy it collects reports for.
 */
export const CSP_REPORT_ENDPOINT_PATH = '/api/csp-report'

/**
 * The `report-to` CSP directive references this group name; the
 * `Reporting-Endpoints` response header (set in `src/proxy.ts`) maps it to
 * {@link CSP_REPORT_ENDPOINT_PATH}. `report-uri` (also in the CSP) points
 * directly at the path instead, for browsers that don't support the newer
 * Reporting API — both directives are kept so either delivery mechanism
 * reaches the same endpoint.
 */
export const CSP_REPORTING_GROUP_NAME = 'csp-endpoint'
