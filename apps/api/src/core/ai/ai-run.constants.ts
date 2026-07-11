import type { JobOptions } from '@/infrastructure/queue/interfaces/job-options.interface'
import { DEFAULT_JOB_OPTIONS } from '@/infrastructure/queue/interfaces/job-options.interface'

/**
 * Default attempt budget frozen onto a new `AiRun` (Track C — ADR-054, locked decision). Postgres
 * owns the retry schedule; the worker (Arc C.4) honors the gateway `retryable` flag up to this
 * many attempts. The SDK's own retry stays disabled.
 */
export const AI_RUN_DEFAULT_MAX_ATTEMPTS = 3

/** Bounded, machine-readable terminal reason for a user-requested cancellation (no content). */
export const AI_RUN_CANCELLED_BY_USER = 'cancelled_by_user'

/**
 * Terminal reason/error codes an owner decision may set when it inline-expires a stale approval
 * (Track C — ADR-054, Arc E.5). They **mirror** the worker `AiRunTerminalReason`/`AiRunErrorCode`
 * values so the wire stays consistent across roles: a run whose deadline passed goes `EXPIRED`
 * (`deadline_exceeded`); one whose approval TTL elapsed first goes `FAILED` (`approval_expired`, under
 * the `tool_loop_failed` umbrella error code).
 */
export const AI_RUN_DEADLINE_EXCEEDED = 'deadline_exceeded'
export const AI_RUN_APPROVAL_EXPIRED = 'approval_expired'
export const AI_RUN_TOOL_LOOP_FAILED = 'tool_loop_failed'

/** Content-free `ai.approval.expired` reason for an approval voided because its run was cancelled. */
export const AI_APPROVAL_RUN_CANCELLED = 'run_cancelled'

/**
 * Terminal reason for a bot run abandoned because a human took control of the conversation (Arc F
 * takeover). **Mirrors** the worker `AiRunTerminalReason.SUPERSEDED_BY_HUMAN` so the wire stays
 * consistent whether the run was superseded by the take-time sweep (here) or the worker fence.
 */
export const AI_RUN_SUPERSEDED_BY_HUMAN = 'superseded_by_human'

/** Defensive cap on the owner approval list (approvals are few; unpaginated read). */
export const AI_APPROVAL_LIST_LIMIT = 100

/** Max stale approvals the worker expiry sweep terminalizes per cron tick (each in its own tx). */
export const AI_APPROVAL_EXPIRY_BATCH_LIMIT = 50

/**
 * Wake-job options for the `AI_RUNS` queue (ADR-052 pattern). A single attempt: the wake is only a
 * hint to drain due runs — Postgres `FOR UPDATE SKIP LOCKED` is the real dedupe and the recovery
 * cron (Arc C.4) re-drains, so a lost/duplicate wake strands nothing. No `jobId` dedupe needed.
 */
export const AI_RUN_WAKE_JOB_OPTIONS: JobOptions = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 1,
  backoff: undefined,
}
