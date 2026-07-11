import {
  GUARDRAIL_BOUNDARY_TAG_PREFIX,
  GUARDRAIL_OUTPUT_CATEGORY,
  GUARDRAIL_PREAMBLE_SENTINELS,
} from './guardrail.constants'
import type { GuardResult } from './guardrail.types'
import { CategoryTally } from './guardrail-result'

/**
 * Deterministic **output guard** (Track C — ADR-054 / ADR-055, Arc D). Pure and unwired here; the
 * executor consumes it in Arc D.4, running it on the **complete** model output *before* persistence.
 * Any finding is terminal (`block`) — leaked/disclosing output is discarded, never persisted:
 *
 * - `BOUNDARY_MARKER_LEAK` — output echoes AMCore's boundary marker tokens (the run's own marker,
 *   passed in, or the generic prefix);
 * - `PREAMBLE_LEAK` — output reproduces a distinctive fragment of the code-owned trust-boundary
 *   preamble;
 * - `INSTRUCTION_DISCLOSURE` — output self-states it is revealing/obeying hidden or system
 *   instructions.
 *
 * The result is content-free: bounded category codes + counts, never the output or the marker value.
 */

/** Bounded self-disclosure phrasings: the model announcing it reveals/obeys hidden instructions. */
const DISCLOSURE_PATTERNS = [
  /\bmy (system prompt|system message|(hidden|secret|internal|system) instructions?)\b[^.?!\n]{0,24}\b(is|are|say|says|include|state|read)\b/i,
  /\b(here|these) (are|is) my (hidden|secret|internal|system)? ?(instructions?|system prompt|system message)\b/i,
  /\bI (will|am going to|shall|'ll) (now )?(ignore|disregard|bypass|override) (my |the |all )?(previous |system |prior )?(instructions?|rules?|guidelines?|prompt)\b/i,
  /\b(revealing|disclosing|sharing|exposing) my (hidden|secret|internal|system)? ?(instructions?|system prompt|system message)\b/i,
]

/**
 * Optional context for the output guard: the run's ACTIVE boundary markers (checked, never stored).
 * A tool loop has more than one — the user-input marker and the tool-result marker (Arc E) — and the
 * guard must detect leakage of every one, not only the first.
 */
export interface OutputGuardContext {
  markers?: string[]
}

/** Scan complete model output and return a content-free verdict (Arc D output guard). */
export function scanOutput(output: string, context: OutputGuardContext = {}): GuardResult {
  const tally = new CategoryTally()
  const lower = output.toLowerCase()

  for (const marker of context.markers ?? []) {
    if (lower.includes(marker.toLowerCase())) {
      tally.add(GUARDRAIL_OUTPUT_CATEGORY.BOUNDARY_MARKER_LEAK)
    }
  }
  if (lower.includes(GUARDRAIL_BOUNDARY_TAG_PREFIX)) {
    tally.add(GUARDRAIL_OUTPUT_CATEGORY.BOUNDARY_MARKER_LEAK)
  }
  for (const sentinel of GUARDRAIL_PREAMBLE_SENTINELS) {
    if (lower.includes(sentinel.toLowerCase())) tally.add(GUARDRAIL_OUTPUT_CATEGORY.PREAMBLE_LEAK)
  }
  if (DISCLOSURE_PATTERNS.some((pattern) => pattern.test(output))) {
    tally.add(GUARDRAIL_OUTPUT_CATEGORY.INSTRUCTION_DISCLOSURE)
  }

  // Any output finding is terminal — there is no advisory tier for output.
  return tally.toResult(tally.size > 0 ? 'block' : 'allow')
}
