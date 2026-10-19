import { DelayedError, UnrecoverableError } from 'bullmq'

export type JobRunOutcome = 'completed' | 'delayed' | 'permanent_failure' | 'transient_failure'

export interface JobRunEvent {
  readonly event: 'job.finished'
  readonly queue: string
  readonly jobName: string
  readonly outcome: JobRunOutcome
  readonly durationMs: number
  /** Present for a permanent failure: the already sanitized work reason code. */
  readonly reason?: string
}

/** Classifies what `ManagedProcessor.run` ended with; errors there are already sanitized. */
export function jobRunOutcome(error: unknown): JobRunOutcome {
  if (error === undefined) return 'completed'
  if (error instanceof DelayedError) return 'delayed'
  if (error instanceof UnrecoverableError) return 'permanent_failure'
  return 'transient_failure'
}

/**
 * One line per job run, so a request's worker half is visible even when nothing else logged:
 * a successful job is otherwise silent. Only the queue, job name, outcome, duration and a safe
 * reason code are included, never payload, recipient or exception text.
 */
export function jobRunEvent(
  queue: string,
  jobName: string,
  error: unknown,
  durationMs: number
): JobRunEvent {
  const outcome = jobRunOutcome(error)
  return {
    event: 'job.finished',
    queue,
    jobName,
    outcome,
    durationMs,
    ...(outcome === 'permanent_failure' && error instanceof Error ? { reason: error.message } : {}),
  }
}
