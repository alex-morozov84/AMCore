import type { Prisma } from '@prisma/client'

/**
 * A run atomically claimed for one execution attempt: leased (`RUNNING`), its `attemptCount` already
 * incremented to `attemptNumber`, `startedAt` stamped. The executor (Arc C.4) loads the transcript
 * and performs the provider call for this run, then finalizes it via a CAS keyed by
 * `(id, status=RUNNING, leaseToken)`. `modelSnapshot` is the frozen secret-free model chosen at
 * creation — the executor resolves the credential from `modelSnapshot.modelSlug`, never the current
 * default.
 */
export interface ClaimedRun {
  id: string
  conversationId: string
  modelSnapshot: Prisma.JsonValue
  /** The attempt number this claim represents (== post-increment `attemptCount`). */
  attemptNumber: number
  maxAttempts: number
  deadlineAt: Date | null
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
