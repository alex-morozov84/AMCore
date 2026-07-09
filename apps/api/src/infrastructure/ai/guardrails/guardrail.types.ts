import type { GUARDRAIL_INPUT_CATEGORY, GUARDRAIL_OUTPUT_CATEGORY } from './guardrail.constants'

/**
 * Guardrail verdict + result contracts (Track C — ADR-054 / ADR-055, Arc D). Server-owned and
 * **content-free**: a result carries only bounded category codes and counts — never a prompt/output
 * snippet, matched substring, or the boundary marker value. There is deliberately **no shared
 * (`packages/shared`) schema**: these are internal worker-side constants, like `AiRunTerminalReason`.
 */

/** The bounded guard decision. `flag` proceeds (advisory); `block` is a terminal guardrail stop. */
export type GuardVerdict = 'allow' | 'flag' | 'block'

/** A bounded input-guard finding category (see `GUARDRAIL_INPUT_CATEGORY`). */
export type GuardInputCategory =
  (typeof GUARDRAIL_INPUT_CATEGORY)[keyof typeof GUARDRAIL_INPUT_CATEGORY]

/** A bounded output-guard finding category (see `GUARDRAIL_OUTPUT_CATEGORY`). */
export type GuardOutputCategory =
  (typeof GUARDRAIL_OUTPUT_CATEGORY)[keyof typeof GUARDRAIL_OUTPUT_CATEGORY]

/** One content-free finding: a bounded category code and how many signals fired for it. */
export interface GuardCategoryHit {
  category: string
  count: number
}

/** A guard's decision plus its content-free findings. Never carries user/model content. */
export interface GuardResult {
  verdict: GuardVerdict
  categories: GuardCategoryHit[]
}
