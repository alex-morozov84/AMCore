import { z } from 'zod'

import 'server-only'

const CspModeSchema = z.enum(['enforce', 'report-only'])

export type CspMode = z.infer<typeof CspModeSchema>

/**
 * PR2 (`ai/models-talk.md` FINAL PLAN §3) ships this track's CSP in
 * `report-only` diagnostic mode — nothing is blocked, browsers only report
 * violations. A later PR in the same track flips AMCore's own production
 * default to `enforce` (owner decision §0.1: production security posture
 * must be secure-by-default). `WEB_CSP_MODE` lets an operator override
 * either direction — including AMCore itself, or a downstream fork
 * temporarily weakening to `report-only` while integrating a new
 * third-party script/style origin — matching the ADR-072
 * validated-env-var-module pattern (`trusted-client-ip.ts`): unset means
 * the safe, currently-shipped default, and an unrecognized value fails
 * loudly rather than silently falling back.
 */
export function getCspMode(): CspMode {
  const raw = process.env.WEB_CSP_MODE?.trim()
  if (!raw) return 'report-only'

  const parsed = CspModeSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `WEB_CSP_MODE: unsupported value "${raw}" - expected "enforce" or "report-only"`
    )
  }
  return parsed.data
}
