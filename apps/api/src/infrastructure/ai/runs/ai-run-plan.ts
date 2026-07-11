import type { AiGenerateMessage } from '../gateway/ai-gateway.types'

import type { GuardrailStepCategory } from './ai-run-dispatch.types'

/** Ledger attribution snapshotted from the run's conversation (no FK; content-free). */
export interface RunAttribution {
  userId: string | null
  organizationId: string | null
}

/**
 * Everything the bounded tool loop needs, resolved during pre-flight (Track C — ADR-054, Arc E). The
 * executor's `preflight` builds it (Arc D trust boundary + the bound assistant's tool allowlist); the
 * loop executor consumes it. No secret rides it.
 */
export interface RunPlan {
  modelSlug: string
  /** Trusted instruction channel (Arc D structural trust boundary), before any tool augmentation. */
  system: string
  /** The untrusted user turn, JSON-encoded inside the salted boundary container (Arc D). */
  userMessages: AiGenerateMessage[]
  /** This run's user-input boundary marker — handed to the output guard to detect leakage (Arc D). */
  marker: string
  /**
   * The bound assistant's `toolAllowlist` (stable tool ids), or empty when the conversation is not
   * assistant-bound — an empty allowlist degenerates the loop to the Arc C single-call text path.
   */
  toolAllowlist: string[]
  /**
   * Content-free findings from an input guard `flag` (Arc D). Recorded as a `GUARDRAIL_CHECK` step
   * INSIDE the success finalize transaction — empty when the input allowed or the guard is `off`.
   */
  inputFlagCategories: GuardrailStepCategory[]
  attribution: RunAttribution
}
