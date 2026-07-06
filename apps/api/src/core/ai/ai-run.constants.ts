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
 * Wake-job options for the `AI_RUNS` queue (ADR-052 pattern). A single attempt: the wake is only a
 * hint to drain due runs — Postgres `FOR UPDATE SKIP LOCKED` is the real dedupe and the recovery
 * cron (Arc C.4) re-drains, so a lost/duplicate wake strands nothing. No `jobId` dedupe needed.
 */
export const AI_RUN_WAKE_JOB_OPTIONS: JobOptions = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 1,
  backoff: undefined,
}
