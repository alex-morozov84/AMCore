import { z } from 'zod'

import 'server-only'

const CspModeSchema = z.enum(['enforce', 'report-only'])

export type CspMode = z.infer<typeof CspModeSchema>

/**
 * Track 3 PR4 (`ai/models-talk.md` FINAL PLAN §3) — the default is
 * environment-aware: `enforce` in production (owner decision §0.1:
 * production security posture must be secure-by-default), `report-only` in
 * development. The development exception is not caution for its own
 * sake — it's an observed, reproduced constraint: `next dev`'s own
 * Turbopack HMR machinery injects dozens of inline `<style>` tags for its
 * own tooling (confirmed via a real browser under `WEB_CSP_MODE=enforce`
 * against `next dev` — every one blocked, logged as a CSP violation in the
 * console, though the app's own Tailwind output is unaffected since it
 * loads via an external stylesheet). Enforcing there trades a noisy dev
 * console — and likely CSS hot-reload falling back to full reloads — for
 * no real security benefit, since `next dev` is never the artifact that
 * ships (`ai/STATUS.md` working rule 1).
 *
 * `WEB_CSP_MODE` lets an operator override either direction — including
 * AMCore itself, or a downstream fork temporarily weakening to
 * `report-only` in production while integrating a new third-party
 * script/style origin — matching the ADR-072 validated-env-var-module
 * pattern (`trusted-client-ip.ts`): unset means the environment-appropriate
 * default, and an unrecognized value fails loudly rather than silently
 * falling back.
 */
export function getCspMode(): CspMode {
  const raw = process.env.WEB_CSP_MODE?.trim()
  if (!raw) return process.env.NODE_ENV === 'development' ? 'report-only' : 'enforce'

  const parsed = CspModeSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `WEB_CSP_MODE: unsupported value "${raw}" - expected "enforce" or "report-only"`
    )
  }
  return parsed.data
}
