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

/**
 * Runs executed concurrently per worker process, shared by the wake job and the recovery tick (a
 * per-process capacity gate, not a fleet quota or rate limit). Each lane claims ONE run at a time, so
 * a lease starts when its work starts and never ages in a batch tail. A slot is held until the
 * physical provider/tool call has settled. Tuned by code change, not env (starter convention).
 */
export const AI_RUN_DISPATCH_CONCURRENCY = 2

/** Max runs claimed per SKIP-LOCKED pass: one per lane (see `AI_RUN_DISPATCH_CONCURRENCY`). */
export const AI_RUN_CLAIM_BATCH_LIMIT = 1

/**
 * Hard cap on lease epochs (execution attempts) per run, checked BEFORE a claim so the attempt
 * history stays bounded without ever evicting rows. Legal sequences fit with wide margin: at most
 * `maxAttempts` (3) executions plus one resume per approval park (≤ `AI_TOOL_LOOP_MAX_STEPS`, max 50).
 * A run at the cap is failed `attempts_exhausted` instead of being claimed again.
 */
export const AI_RUN_MAX_EPOCHS = 128

/** Bounded wait for the conversation/run row locks of a guarded write (fails closed, never stalls a lane). */
export const AI_RUN_GUARD_LOCK_TIMEOUT_MS = 5 * 1000

/**
 * Shutdown grace for the AI dispatcher: after the latch closes, in-flight lanes get this long before the
 * cutoff seals (aborting calls); below the Prisma barrier safety cap. A run interrupted by the seal is
 * recovered through lease expiry — the seal never writes.
 */
export const AI_RUN_SHUTDOWN_GRACE_MS = 15 * 1000

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
  /**
   * Arc E bounded tool loop terminal reasons (non-retryable). The loop hit its step bound, the model
   * broke the one-call-per-step contract, requested a tool it may not use, produced invalid tool
   * arguments, a tool failed host-side, or requested an approval-gated tool before Arc E.5 wires the
   * durable park (the E.4 placeholder — E.5 parks to WAITING_APPROVAL instead of failing).
   */
  TOOL_LOOP_EXHAUSTED: 'tool_loop_exhausted',
  TOO_MANY_TOOL_CALLS: 'too_many_tool_calls',
  TOOL_NOT_ALLOWED: 'tool_not_allowed',
  TOOL_ARGS_INVALID: 'tool_args_invalid',
  TOOL_EXECUTION_FAILED: 'tool_execution_failed',
  /**
   * A tool call needing human approval was requested (Arc E). Until Arc E.5 wired the durable park this
   * was a terminal placeholder; from E.5 the loop parks the run in `WAITING_APPROVAL` instead, and this
   * value is emitted only if the approval TTL elapses before a decision (`APPROVAL_EXPIRED`).
   */
  TOOL_APPROVAL_REQUIRED: 'tool_approval_required',
  /** The approval TTL elapsed before the owner decided (Arc E.5); the run fails non-retryably. */
  APPROVAL_EXPIRED: 'approval_expired',
  /**
   * A human took control of the conversation (ADR-049 fence, Arc F): the run's `ownershipGeneration`
   * snapshot no longer matches the conversation, so the worker abandons it terminally as `CANCELLED`
   * without writing a stale bot turn. Distinct from a user-requested cancel.
   */
  SUPERSEDED_BY_HUMAN: 'superseded_by_human',
  /**
   * The conversation's bound assistant was disabled after this run was queued (Arc F.4 kill-switch):
   * terminal, non-retryable `FAILED` before any provider I/O. The producer gates new runs; this catches
   * a disable that races an already-queued run.
   */
  ASSISTANT_DISABLED: 'assistant_disabled',
  /**
   * A side-effecting tool may or may not have produced its external effect (timeout, crash or an
   * unclassified error). The run stops: no new tool action, no new model request. Terminal, non-retryable.
   */
  TOOL_EFFECT_UNKNOWN: 'tool_effect_unknown',
  /** Durable tool state is inconsistent (e.g. a result without its application step); fail closed. */
  TOOL_STATE_INCONSISTENT: 'tool_state_inconsistent',
  /** The same requested action reappeared with different normalized input; fail closed, no tool call. */
  ACTION_INPUT_CONFLICT: 'action_input_conflict',
  /** A stored tool input no longer parses to itself under the current tool schema; never executed. */
  TOOL_SCHEMA_INCOMPATIBLE: 'tool_schema_incompatible',
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
  /**
   * The input turn carried neither a text part nor an `artifact_ref` part (Arc G: an artifact-only
   * turn, e.g. an image with no caption, is now valid — this only fires when both are absent).
   */
  NO_INPUT: 'no_input',
  /**
   * A referenced artifact could not be used: its row was missing, the frozen model snapshot lacks
   * the required capability (worker backstop — the producer already gated this; should never
   * actually fire), or the storage fetch failed (deleted/corrupted object). Terminal,
   * non-retryable — analogous to `INPUT_MISSING`/`NO_INPUT`.
   */
  ARTIFACT_UNAVAILABLE: 'artifact_unavailable',
  /** An unexpected non-gateway error around the provider call; retried defensively. */
  UNKNOWN_ERROR: 'unknown_error',
  /** A guardrail blocked the run (input/output/oversize); the specific reason is terminalReasonCode. */
  GUARDRAIL_BLOCKED: 'guardrail_blocked',
  /**
   * The bounded tool loop terminally failed (Arc E). Umbrella `errorCode`; the specific cause is the
   * `terminalReasonCode` (`tool_loop_exhausted`/`too_many_tool_calls`/`tool_not_allowed`/
   * `tool_args_invalid`/`tool_execution_failed`/`tool_approval_required`), mirroring `GUARDRAIL_BLOCKED`.
   */
  TOOL_LOOP_FAILED: 'tool_loop_failed',
  /** The conversation's bound assistant was disabled before execution (Arc F.4 kill-switch). */
  ASSISTANT_DISABLED: 'assistant_disabled',
  /** The run reached `AI_RUN_MAX_EPOCHS` execution attempts; its history is full, so it is failed. */
  ATTEMPT_HISTORY_EXHAUSTED: 'attempt_history_exhausted',
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
