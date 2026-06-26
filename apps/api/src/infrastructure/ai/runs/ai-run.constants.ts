/**
 * Durable AI-run dispatch constants (Track C — ADR-054, ADR-052 pattern). Postgres owns the run
 * lease, retry budget, and schedule — these are starter defaults tuned by code change, not env
 * (matching the notification dispatcher convention). Worker-side only.
 */

/**
 * Lease TTL for a claimed (`RUNNING`) run. It must exceed the maximum bounded provider call
 * (`AI_REQUEST_TIMEOUT_MS` maxes at 300s) with enough room for finalization. Lease renewal is
 * deferred until token streaming/tool loops introduce genuinely long-running work.
 */
export const AI_RUN_LEASE_TTL_MS = 10 * 60 * 1000 // 10 min

/** Max runs claimed per SKIP-LOCKED pass (runs are heavier than notifications → smaller batch). */
export const AI_RUN_CLAIM_BATCH_LIMIT = 20

/** Max expired-lease runs reaped per pass, and overdue-deadline runs expired per pass. */
export const AI_RUN_REAP_BATCH_LIMIT = 20

/** Exponential backoff schedule for a re-queued retry (Postgres owns the schedule). */
export const AI_RUN_BACKOFF_BASE_MS = 30 * 1000 // 30 s → 60 → 120 → 240
export const AI_RUN_BACKOFF_CAP_MS = 15 * 60 * 1000 // 15 min
export const AI_RUN_BACKOFF_JITTER = 0.2 // ±20% full jitter

/**
 * Defensive max for a provider-requested retry **floor** (a provider may ask us to wait). Honored
 * as a floor over the normal backoff but clamped so a corrupt value can't park a run indefinitely.
 */
export const AI_RUN_RETRY_AFTER_MAX_MS = 24 * 60 * 60 * 1000 // 24 h

/**
 * Bounded, machine-readable terminal reasons (`AiRun.terminalReasonCode`) the worker owns — never
 * a provider body, prompt, or free text. The web-initiated cancellation reason lives with the
 * producer (`core/ai/ai-run.constants.ts`).
 */
export const AiRunTerminalReason = {
  ATTEMPTS_EXHAUSTED: 'attempts_exhausted',
  DEADLINE_EXCEEDED: 'deadline_exceeded',
  PERMANENT_FAILURE: 'permanent_failure',
} as const

/** Bounded run-attempt/transition error codes (`AiRun.errorCode`), distinct from the reason. */
export const AiRunErrorCode = {
  LEASE_EXPIRED: 'lease_expired',
} as const
