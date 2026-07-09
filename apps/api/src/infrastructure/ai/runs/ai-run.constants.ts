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

/**
 * Max claim→execute batches a single drain pass runs before yielding (a wake/recovery tick).
 * Bounds one drain so a large backlog cannot monopolize a worker; the next tick continues it.
 */
export const AI_RUN_MAX_DRAIN_CYCLES = 5

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
  /** A cooperative user cancel observed by the executor mid-run. Mirrors the producer's value. */
  CANCELLED_BY_USER: 'cancelled_by_user',
  /**
   * Arc D guardrail refusals (terminal, **non-retryable**). Set as `terminalReasonCode` so the wire
   * (`toAiRunResponse`) lets a client distinguish a policy refusal from an engine failure. The
   * detectors that pick which reason applies are wired in Arc D.4.
   */
  GUARDRAIL_INPUT_BLOCKED: 'guardrail_input_blocked',
  GUARDRAIL_OUTPUT_BLOCKED: 'guardrail_output_blocked',
  GUARDRAIL_INPUT_TOO_LARGE: 'guardrail_input_too_large',
} as const

/**
 * Bounded run-attempt/transition error codes (`AiRun.errorCode`), distinct from the reason. Every
 * value is machine-readable and content-free — never a prompt, provider body, or free text. The
 * gateway's own taxonomy (`AiGatewayException.code`) supplies the codes for provider-call failures;
 * these cover executor-side pre-flight/finalization faults.
 */
export const AiRunErrorCode = {
  LEASE_EXPIRED: 'lease_expired',
  /** The frozen `modelSnapshot` did not carry a usable `modelSlug`. */
  MODEL_SNAPSHOT_INVALID: 'model_snapshot_invalid',
  /** The run's own input turn (`AiMessage.runId = run.id`) was absent. */
  INPUT_MISSING: 'input_missing',
  /** The input turn carried no text part (Arc C is text-only). */
  NO_INPUT_TEXT: 'no_input_text',
  /** An unexpected non-gateway error around the provider call; retried defensively. */
  UNKNOWN_ERROR: 'unknown_error',
  /** A guardrail blocked the run (input/output/oversize); the specific reason is terminalReasonCode. */
  GUARDRAIL_BLOCKED: 'guardrail_blocked',
} as const

/**
 * Fixed, content-free refusal turn persisted when a guardrail blocks a run (Arc D). It is a constant
 * string only — it never reflects the user's input or the model's output.
 */
export const AI_RUN_GUARDRAIL_REFUSAL_MESSAGE = "I can't help with that request."

/** `AiMessage.redactionMeta.classification` marking a canned guardrail-refusal assistant turn. */
export const AI_RUN_GUARDRAIL_REFUSAL_CLASSIFICATION = 'guardrail_refusal'

/**
 * Bounded grammar for a guardrail finding category code persisted on a refusal check step. The
 * finalizer enforces this **defensively** (it does not trust the caller), so a snippet, marker
 * value, whitespace, or long string can never reach `AiRunStep.detail` — only a short lowercase code.
 */
export const AI_RUN_GUARDRAIL_CATEGORY_CODE = /^[a-z][a-z0-9_]{0,63}$/

/** Defensive cap on distinct guardrail categories recorded on one refusal check step. */
export const AI_RUN_GUARDRAIL_MAX_CATEGORIES = 16
