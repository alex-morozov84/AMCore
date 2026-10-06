import type { AiRunStepType, Prisma } from '@/generated/prisma/client'

/**
 * Why a run must stop before its next action (deterministic precedence when several apply at once:
 * `cancelled` > `superseded` > `expired`). Evaluated by the run guard from fresh database state.
 */
export type StopCause = 'cancelled' | 'superseded' | 'expired'

/**
 * A run atomically claimed for one execution attempt: leased (`RUNNING`), its lease epoch incremented
 * and an attempt-history row opened, `startedAt` stamped. The executor loads the transcript and runs
 * the loop; every durable write goes through the run guard, which re-checks the lease (token + epoch +
 * fresh-clock expiry) under row locks. `modelSnapshot` is the frozen secret-free model chosen at
 * creation — the executor resolves the credential from `modelSnapshot.modelSlug`, never the current
 * default.
 */
export interface ClaimedRun {
  id: string
  conversationId: string
  modelSnapshot: Prisma.JsonValue
  /** The monotonic lease epoch of this claim — the identity of this execution attempt. */
  epoch: number
  /**
   * The retry ordinal of this execution (`attemptCount + 1`: consumed retries plus this one). Used only
   * for the retry budget and backoff — NOT for history identity (that is `epoch`).
   */
  attemptNumber: number
  maxAttempts: number
  deadlineAt: Date | null
  /**
   * The owning conversation's `ownershipGeneration` frozen at run creation (ADR-049 fence, Arc F).
   * Every durable transcript write re-checks it under lock; a mismatch means a human took over and
   * the run is abandoned `CANCELLED`/`superseded_by_human` without writing.
   */
  ownershipGeneration: number
  /** Batch lease token; every finalizer CAS keys on `(id, status=RUNNING, leaseToken)`. */
  leaseToken: string
}

/** Outcome of a transient-failure finalize: re-queued with backoff, or terminal once exhausted. */
export type RunRetryOutcome =
  | { state: 'retry_scheduled'; nextAttemptAt: Date }
  | { state: 'failed'; reasonCode: string }
  /** The CAS matched no row — the lease was lost/expired and reclaimed elsewhere. */
  | { state: 'lease_lost' }

/** Aggregate outcome of one reaper pass over expired `RUNNING` leases. */
export interface RunReapResult {
  rescheduled: number
  failed: number
}

/** One content-free guard finding recorded on a refusal check step (bounded code + count only). */
export interface GuardrailStepCategory {
  category: string
  count: number
}

/**
 * Inputs to `AiRunRepository.finalizeRefusal` (Track C — ADR-054 / ADR-055, Arc D). Every field is
 * bounded and content-free; the detectors that populate them are wired in Arc D.4.
 */
export interface GuardrailRefusalInput {
  /** Bounded terminal reason (e.g. `AiRunTerminalReason.GUARDRAIL_INPUT_BLOCKED`). */
  reasonCode: string
  /** The guard-stage step type: `GUARDRAIL_CHECK` for input, `OUTPUT_VALIDATION` for output. */
  checkStepType: AiRunStepType
  /** Content-free findings for the check step's `detail` (bounded category codes + counts only). */
  categories?: GuardrailStepCategory[]
}
