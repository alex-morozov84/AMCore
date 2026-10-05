import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AiRunTerminalReason } from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import type {
  ClaimedRun,
  GuardrailRefusalInput,
  RunRetryOutcome,
  StopCause,
} from './ai-run-dispatch.types'
import { AiRunGuard, type GuardOutcome, RunLeaseLostError } from './ai-run-guard.service'

import type { Prisma } from '@/generated/prisma/client'

/** Whether a guarded transition committed. `lease_lost`/`cutoff` mean nothing was written. */
export type TransitionResult = 'applied' | 'lease_lost' | 'cutoff'

/**
 * Terminalize the run for a visible stop cause, inside an OPEN guarded transaction: a user cancel,
 * a human takeover, or a passed deadline. One place so every path agrees on the reason/outcome.
 */
export async function applyStop(
  tx: Prisma.TransactionClient,
  repository: AiRunRepository,
  claim: ClaimedRun,
  cause: StopCause
): Promise<void> {
  const won =
    cause === 'cancelled'
      ? await repository.finalizeCancelled(tx, claim, AiRunTerminalReason.CANCELLED_BY_USER)
      : cause === 'superseded'
        ? await repository.finalizeSuperseded(tx, claim)
        : await repository.finalizeExpired(tx, claim)
  if (!won) throw new RunLeaseLostError()
}

/**
 * Self-contained run transitions for callers that have no other write to compose with (pre-flight,
 * gateway errors, stop causes). Each runs in ONE guarded `record` transaction, so a stale holder gets
 * `lease_lost` and writes nothing, and every outcome closes the attempt-history row atomically. When a
 * stop cause is visible under the locks it WINS over the requested transition (precedence cancelled >
 * superseded > expired): a retry, failure or refusal is never written over a cancel or a takeover.
 */
@Injectable()
export class AiRunTransitions {
  constructor(
    private readonly guard: AiRunGuard,
    private readonly repository: AiRunRepository,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunTransitions.name)
  }

  /** Terminalize for a stop cause the caller already observed (e.g. a refused admission). */
  stop(claim: ClaimedRun, cause: StopCause): Promise<TransitionResult> {
    return this.apply(claim, (tx) => applyStop(tx, this.repository, claim, cause))
  }

  /** Terminalize for the stop cause visible under the locks, or `fallback` when none is (a caller abort). */
  settleStop(claim: ClaimedRun, fallback: StopCause): Promise<TransitionResult> {
    return this.apply(claim, (tx, stop) => applyStop(tx, this.repository, claim, stop ?? fallback))
  }

  /** Permanent failure (unless a stop cause is visible). */
  failed(claim: ClaimedRun, errorCode: string, reasonCode?: string): Promise<TransitionResult> {
    return this.apply(claim, async (tx, stop) => {
      if (stop) return applyStop(tx, this.repository, claim, stop)
      if (!(await this.repository.finalizeFailed(tx, claim, errorCode, reasonCode))) {
        throw new RunLeaseLostError()
      }
    })
  }

  /** Guardrail refusal (steps + canned turn + terminal), unless a stop cause is visible (the stop wins). */
  refusal(claim: ClaimedRun, refusal: GuardrailRefusalInput): Promise<TransitionResult> {
    return this.apply(claim, async (tx, stop) => {
      if (stop) return applyStop(tx, this.repository, claim, stop)
      if (!(await this.repository.finalizeRefusal(tx, claim, refusal))) {
        throw new RunLeaseLostError()
      }
    })
  }

  /** Transient failure: re-queue with backoff or exhaust, unless a stop cause is visible. */
  async retry(
    claim: ClaimedRun,
    errorCode: string,
    retryAfterMs?: number
  ): Promise<RunRetryOutcome | { state: 'cutoff' }> {
    const outcome = await this.guard.record(claim, async (tx, ctx) => {
      if (ctx.stop) {
        await applyStop(tx, this.repository, claim, ctx.stop)
        return { state: 'failed', reasonCode: ctx.stop } as RunRetryOutcome
      }
      const result = await this.repository.finalizeRetry(tx, claim, errorCode, retryAfterMs)
      if (result.state === 'lease_lost') throw new RunLeaseLostError()
      return result
    })
    if (outcome.kind === 'cutoff') return { state: 'cutoff' }
    if (outcome.kind !== 'ok') return { state: 'lease_lost' }
    return outcome.value
  }

  private async apply(
    claim: ClaimedRun,
    fn: (tx: Prisma.TransactionClient, stop: StopCause | null) => Promise<void>
  ): Promise<TransitionResult> {
    const outcome: GuardOutcome<void> = await this.guard.record(claim, (tx, ctx) =>
      fn(tx, ctx.stop)
    )
    if (outcome.kind === 'ok') return 'applied'
    if (outcome.kind === 'cutoff') return 'cutoff'
    this.logger.warn(
      { event: 'ai.run.transition_lease_lost', runId: claim.id },
      'AI run lease lost before a transition; nothing was written'
    )
    return 'lease_lost'
  }
}
