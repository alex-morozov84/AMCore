import { config } from 'zod'

import 'client-only'

/**
 * Side-effect-only: disables Zod v4's `new Function()`-based fast-path
 * validator compiler in the browser. Zod's own internal capability probe
 * (`zod/v4/core/util.js`) calls `Function("")` to detect whether dynamic
 * code construction is available — a genuine `script-src` violation under
 * Track 3's nonce-based CSP (`ai/models-talk.md` FINAL PLAN §3), confirmed
 * empirically against the real production build (`e2e/real-stack/csp-nonce.spec.ts`):
 * absent under `next dev` (which already ships `'unsafe-eval'`), present
 * and reproducible in the standalone server.
 *
 * `jitless` is Zod's own documented escape hatch for exactly this class of
 * environment (its source comment: "exists precisely so CSP/no-eval
 * environments never reach `new Function`") — not a private internal used
 * off-label. Scoped to `apps/web` only: `apps/api` never runs under a
 * browser CSP, so its Zod usage is unaffected and this module is never
 * imported there. Purely a runtime-compilation optimization Zod disables
 * per-schema on the same fallback path when the probe fails anyway — no
 * observable validation behavior changes, only where the fast path is
 * skipped.
 *
 * Import this once, as early as possible in the client bundle (currently:
 * the top of `app/[locale]/providers.tsx`, the first Client Component
 * boundary every route mounts) — before any schema's first `.parse()` call
 * in the browser.
 */
config({ jitless: true })
