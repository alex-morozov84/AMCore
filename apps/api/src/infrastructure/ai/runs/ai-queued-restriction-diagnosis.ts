import { closeAttempt, closeRunInvocations } from './ai-run-attempts'
import { isBotOwnershipStale, type OwnershipFenceRow } from './ai-run-ownership-fence'

import { AiRunAttemptOutcome, AiRunStatus, AiRunStepType, Prisma } from '@/generated/prisma/client'
import { CUTOFF, type ShutdownLatch } from '@/infrastructure/worker-lifecycle'
import type { PrismaService } from '@/prisma'
import type { ObservedTransactionRunner } from '@/prisma/observed-transaction'

interface Candidate {
  id: string
  conversationId: string
}
interface LockedRun {
  id: string
  leaseEpoch: number
  ownershipGeneration: number
  cancellationRequestedAt: Date | null
  deadlineAt: Date | null
}
interface Diagnosis {
  classification: string
  at: Date
}

/** Diagnostic-only recovery. Never creates an execution lease or calls a provider/tool. */
export class AiQueuedRestrictionDiagnosis {
  private readonly runner: ObservedTransactionRunner
  private active = false
  private nextStart = 0

  constructor(
    prisma: PrismaService,
    private readonly latch: ShutdownLatch
  ) {
    this.runner = prisma.observedTransactions('ai-diagnosis')
  }

  async sweep(): Promise<number> {
    if (this.latch.closed || this.active || performance.now() < this.nextStart) return 0
    this.active = true
    this.nextStart = performance.now() + 30_000
    const endStartsAt = performance.now() + 2000
    try {
      const candidates = await this.latch.transaction(this.runner, async (tx) => {
        await configure(tx)
        return tx.$queryRaw<Candidate[]>(Prisma.sql`
          SELECT id, "conversationId" FROM ai.ai_runs
          WHERE status = 'QUEUED'::ai."AiRunStatus"
            AND (SELECT classification FROM ai.classify_provider_retry_restriction("providerRetryRestriction", clock_timestamp())) IN ('invalid','unknown')
          ORDER BY "updatedAt", id LIMIT 20
        `)
      })
      if (candidates === CUTOFF) return 0
      let count = 0
      for (const candidate of candidates) {
        if (this.latch.closed || performance.now() >= endStartsAt) break
        const settled = await this.latch.transaction(this.runner, (tx) =>
          this.diagnose(tx, candidate)
        )
        if (settled === CUTOFF) break
        count += settled ? 1 : 0
      }
      return count
    } finally {
      this.active = false
    }
  }

  private async diagnose(tx: Prisma.TransactionClient, candidate: Candidate): Promise<boolean> {
    await configure(tx)
    const conversations = await tx.$queryRaw<OwnershipFenceRow[]>(Prisma.sql`
      SELECT "ownershipGeneration", "controlledBy"::text, state::text FROM ai.ai_conversations
      WHERE id = ${candidate.conversationId} FOR UPDATE SKIP LOCKED
    `)
    if (!conversations[0]) return false
    const rows = await tx.$queryRaw<LockedRun[]>(Prisma.sql`
      SELECT id, "leaseEpoch", "ownershipGeneration", "cancellationRequestedAt", "deadlineAt"
      FROM ai.ai_runs WHERE id = ${candidate.id} AND "conversationId" = ${candidate.conversationId}
        AND status = 'QUEUED'::ai."AiRunStatus" FOR UPDATE SKIP LOCKED
    `)
    const run = rows[0]
    if (!run) return false
    const diagnoses = await tx.$queryRaw<Diagnosis[]>(Prisma.sql`
      WITH timing AS MATERIALIZED (SELECT clock_timestamp() AS at)
      SELECT restriction.classification, timing.at FROM ai.ai_runs, timing,
        LATERAL ai.classify_provider_retry_restriction("providerRetryRestriction", timing.at) restriction
      WHERE id = ${run.id}
    `)
    const diagnosis = diagnoses[0]!
    if (!['invalid', 'unknown'].includes(diagnosis.classification)) return false
    const outcome = terminalOutcome(run, conversations[0], diagnosis)
    const changed = await tx.aiRun.updateMany({
      where: {
        id: run.id,
        status: AiRunStatus.QUEUED,
        leaseEpoch: run.leaseEpoch,
        ownershipGeneration: run.ownershipGeneration,
      },
      data: {
        status: outcome.status,
        errorCode: outcome.errorCode,
        terminalReasonCode: outcome.reason,
        finishedAt: diagnosis.at,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    if (changed.count !== 1) return false
    await closeRunInvocations(tx, run.id, 'terminal')
    await closeAttempt(tx, run.id, run.leaseEpoch, outcome.attempt, outcome.errorCode)
    await appendDiagnosis(tx, run, diagnosis, outcome.errorCode)
    return true
  }
}

async function configure(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT set_config('lock_timeout', '250ms', true), set_config('statement_timeout', '1500ms', true)`
}

function terminalOutcome(
  run: LockedRun,
  fence: OwnershipFenceRow,
  diagnosis: Diagnosis
): { status: AiRunStatus; attempt: AiRunAttemptOutcome; errorCode: string | null; reason: string } {
  if (run.cancellationRequestedAt)
    return {
      status: AiRunStatus.CANCELLED,
      attempt: AiRunAttemptOutcome.CANCELLED,
      errorCode: null,
      reason: 'cancelled_by_user',
    }
  if (isBotOwnershipStale(fence, run.ownershipGeneration))
    return {
      status: AiRunStatus.CANCELLED,
      attempt: AiRunAttemptOutcome.SUPERSEDED,
      errorCode: null,
      reason: 'superseded_by_human',
    }
  if (run.deadlineAt && run.deadlineAt <= diagnosis.at)
    return {
      status: AiRunStatus.EXPIRED,
      attempt: AiRunAttemptOutcome.EXPIRED,
      errorCode: null,
      reason: 'deadline_exceeded',
    }
  return {
    status: AiRunStatus.FAILED,
    attempt: AiRunAttemptOutcome.FAILED,
    errorCode:
      diagnosis.classification === 'unknown'
        ? 'provider_retry_after_exceeds_horizon'
        : 'provider_retry_restriction_invalid',
    reason: 'permanent_failure',
  }
}

async function appendDiagnosis(
  tx: Prisma.TransactionClient,
  run: LockedRun,
  diagnosis: Diagnosis,
  code: string | null
): Promise<void> {
  const max = await tx.aiRunStep.aggregate({ where: { runId: run.id }, _max: { stepNumber: true } })
  const step = (max._max.stepNumber ?? 0) + 1
  if (step > 2147483647 || step < 1) return // Corrupt history cannot prevent terminal diagnosis.
  await tx.aiRunStep.create({
    data: {
      runId: run.id,
      stepNumber: step,
      type: AiRunStepType.FINALIZATION,
      detail: {
        kind: 'queued_restriction_diagnosis',
        classification: diagnosis.classification,
        epoch: run.leaseEpoch,
      },
      errorCode: code,
      finishedAt: diagnosis.at,
    },
  })
}
