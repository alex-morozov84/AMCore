import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AI_RUN_GUARD_LOCK_TIMEOUT_MS, AI_RUN_LEASE_TTL_MS } from './ai-run.constants'
import type { ClaimedRun, StopCause } from './ai-run-dispatch.types'
import { isBotOwnershipStale, lockBotOwnership } from './ai-run-ownership-fence'
import { AI_RUN_SHUTDOWN_LATCH } from './ai-run-shutdown'

import { Prisma } from '@/generated/prisma/client'
import { MetricsService } from '@/infrastructure/observability'
import { CUTOFF, type ShutdownLatch } from '@/infrastructure/worker-lifecycle'
import { PrismaService } from '@/prisma'

/** Thrown inside a guarded transaction when a CAS finds the run no longer leased by this claim. */
export class RunLeaseLostError extends Error {
  constructor() {
    super('ai_run_lease_lost')
    this.name = 'RunLeaseLostError'
  }
}

/**
 * What a guarded callback is told about the run it is writing for. `stop` is the highest-precedence
 * stop cause visible under the locks (`cancelled` > `superseded` > `expired`), or `null`.
 */
export interface RunGuardContext {
  /** Fresh primary-clock budget available when this admission starts. */
  deadlineRemainingMs?: number | null
  stop: StopCause | null
  epoch: number
}

/** The result of a guarded transaction. Only `ok` ran the callback; every other kind wrote NOTHING. */
export type GuardOutcome<T> =
  | { kind: 'ok'; value: T; stop: StopCause | null }
  /** `admit` only: a stop cause was visible, so the callback did not run (the caller terminalizes). */
  | { kind: 'stopped'; cause: StopCause }
  /** The lease is gone (token/epoch mismatch, status moved, expired, or a lock wait timed out). */
  | { kind: 'lease_lost' }
  /** The dispatcher is sealed for shutdown; nothing was written. */
  | { kind: 'cutoff' }

export type GuardMode = 'admit' | 'record'

interface GuardOptions {
  /** Mark the attempt's `ioStartedAt` ("admitted / possible start", not proof external I/O happened). */
  markIoStarted?: boolean
}

class RunAdmissionStoppedError extends Error {
  constructor(readonly cause: StopCause) {
    super(cause)
  }
}

interface LeaseRow {
  deadlineRemainingMs: number | null
  cancellationRequestedAt: Date | null
  deadlinePassed: boolean
}

/**
 * The single fencing point for every durable write of an AI run (ownership guard). A lease alone is
 * not safe under pauses: the protected resource must reject a stale holder. Inside ONE transaction —
 * lock order conversation → run, bounded by `lock_timeout` — it
 *
 * 1. locks the conversation and reads its fence columns,
 * 2. locks the run row by identity `(id, RUNNING, leaseToken, leaseEpoch)`,
 * 3. only then renews the lease with FRESH database time and refuses an already-expired lease
 *    (`clock_timestamp()` advances during a lock wait; a pre-lock predicate would not),
 * 4. evaluates every visible stop cause and picks the precedence.
 *
 * Two modes: `admit` (before any provider call, tool start, park or resume — a visible stop cause
 * refuses the action and the callback does not run) and `record` (persisting an already-admitted
 * call's observation or a terminal transition — it runs even when a stop cause is visible, so a
 * returned provider result or a known tool outcome is never erased by a cancel/deadline/takeover).
 * A stale holder gets `lease_lost` and writes nothing. All authority time is database time.
 */
@Injectable()
export class AiRunGuard {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_RUN_SHUTDOWN_LATCH) private readonly latch: ShutdownLatch,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(AiRunGuard.name)
  }

  admit<T>(
    claim: ClaimedRun,
    fn: (tx: Prisma.TransactionClient, ctx: RunGuardContext) => Promise<T>,
    options: GuardOptions = {}
  ): Promise<GuardOutcome<T>> {
    return this.run('admit', claim, fn, options)
  }

  record<T>(
    claim: ClaimedRun,
    fn: (tx: Prisma.TransactionClient, ctx: RunGuardContext) => Promise<T>
  ): Promise<GuardOutcome<T>> {
    return this.run('record', claim, fn, {})
  }

  /** Recheck the same locked ownership after an awaited admission hook. */
  async revalidateAdmission(tx: Prisma.TransactionClient, claim: ClaimedRun): Promise<void> {
    const fence = await lockBotOwnership(tx, claim.conversationId)
    const lease = await lockAndRenewLease(tx, claim)
    const stop = pickStop(lease, isBotOwnershipStale(fence, claim.ownershipGeneration))
    if (stop) throw new RunAdmissionStoppedError(stop)
  }

  private async run<T>(
    mode: GuardMode,
    claim: ClaimedRun,
    fn: (tx: Prisma.TransactionClient, ctx: RunGuardContext) => Promise<T>,
    options: GuardOptions
  ): Promise<GuardOutcome<T>> {
    if (this.latch.closed && mode === 'admit') {
      this.metrics.incAiRunAdmission('shutdown')
      return { kind: 'cutoff' }
    }
    try {
      const outcome = await this.latch.transaction(this.prisma, async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT set_config('lock_timeout', ${`${AI_RUN_GUARD_LOCK_TIMEOUT_MS}ms`}, true)`
        )
        const fence = await lockBotOwnership(tx, claim.conversationId)
        const lease = await lockAndRenewLease(tx, claim)
        const stop = pickStop(lease, isBotOwnershipStale(fence, claim.ownershipGeneration))
        if (mode === 'admit' && stop !== null) return { kind: 'stopped', cause: stop } as const
        if (options.markIoStarted) await markIoStarted(tx, claim)
        const value = await fn(tx, {
          stop,
          epoch: claim.epoch,
          deadlineRemainingMs: lease.deadlineRemainingMs,
        })
        return { kind: 'ok', value, stop } as const
      })
      if (outcome === CUTOFF) return { kind: 'cutoff' }
      if (mode === 'admit') {
        this.metrics.incAiRunAdmission(outcome.kind === 'stopped' ? outcome.cause : 'admitted')
      }
      return outcome
    } catch (error) {
      if (error instanceof RunAdmissionStoppedError) {
        this.metrics.incAiRunAdmission(error.cause)
        return { kind: 'stopped', cause: error.cause }
      }
      if (error instanceof RunLeaseLostError || isLockContention(error)) {
        this.metrics.incAiRunAdmission('lease_lost')
        return { kind: 'lease_lost' }
      }
      throw error
    }
  }
}

/** Lock the run by identity, then renew with fresh DB time; an expired lease is never revived. */
async function lockAndRenewLease(
  tx: Prisma.TransactionClient,
  claim: ClaimedRun
): Promise<LeaseRow> {
  const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM "ai"."ai_runs"
    WHERE id = ${claim.id}
      AND status = 'RUNNING'::"ai"."AiRunStatus"
      AND "leaseToken" = ${claim.leaseToken}
      AND "leaseEpoch" = ${claim.epoch}
    FOR UPDATE
  `)
  if (locked.length === 0) throw new RunLeaseLostError()

  const ttlSeconds = AI_RUN_LEASE_TTL_MS / 1000
  const renewed = await tx.$queryRaw<LeaseRow[]>(Prisma.sql`
    UPDATE "ai"."ai_runs"
    SET "leaseExpiresAt" = clock_timestamp() + make_interval(secs => ${ttlSeconds}::double precision),
        "updatedAt" = now()
    WHERE id = ${claim.id} AND "leaseExpiresAt" > clock_timestamp()
    RETURNING "cancellationRequestedAt",
              EXTRACT(EPOCH FROM ("deadlineAt" - clock_timestamp())) * 1000 AS "deadlineRemainingMs",
              ("deadlineAt" IS NOT NULL AND "deadlineAt" <= clock_timestamp()) AS "deadlinePassed"
  `)
  const row = renewed[0]
  if (row === undefined) throw new RunLeaseLostError()
  return row
}

/** Highest-precedence stop cause: a user cancel, then a human takeover, then the run deadline. */
function pickStop(lease: LeaseRow, superseded: boolean): StopCause | null {
  if (lease.cancellationRequestedAt !== null) return 'cancelled'
  if (superseded) return 'superseded'
  if (lease.deadlinePassed) return 'expired'
  return null
}

export async function markIoStarted(
  tx: Prisma.TransactionClient,
  claim: ClaimedRun
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ai"."ai_run_attempts"
    SET "ioStartedAt" = COALESCE("ioStartedAt", clock_timestamp())
    WHERE "runId" = ${claim.id} AND epoch = ${claim.epoch}
  `)
}

/**
 * A lock wait that hit `lock_timeout` (55P03) or a deadlock (40P01) fails CLOSED: the holder writes
 * nothing and the run recovers through lease expiry. Matched on the SQLSTATE the driver reports.
 */
function isLockContention(error: unknown): boolean {
  const text = `${(error as { code?: unknown })?.code ?? ''} ${(error as Error)?.message ?? ''} ${JSON.stringify(
    (error as { meta?: unknown })?.meta ?? ''
  )}`
  return /55P03|40P01|lock timeout|deadlock detected/i.test(text)
}
