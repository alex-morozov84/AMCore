import type { RetryAfterConstraint } from './retry-after'

export interface QueuedEmailOutcome {
  readonly certainty: 'none' | 'accepted' | 'unknown'
  readonly retryable: boolean
  readonly code: 'COMPLETED' | 'RATE_LIMITED' | 'TRANSIENT_FAILURE' | 'PERMANENT_FAILURE'
  readonly retryAfter?: RetryAfterConstraint
}

/** Approved immutable recipe only; beforeTransport is synchronous at the actual SDK/fetch seam. */
export interface QueuedEmailProvider {
  readonly recipeVersion: 1
  readonly provider: 'resend' | 'mock'
  scope(): string
  send(
    body: string,
    key: string,
    signal: AbortSignal,
    beforeTransport: () => void
  ): Promise<QueuedEmailOutcome>
}
