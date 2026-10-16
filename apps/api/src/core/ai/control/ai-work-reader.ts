import { Injectable } from '@nestjs/common'

import {
  WORK_OPERATIONS,
  type WorkJob,
  workJobSchema,
  type WorkListQuery,
  workListRowSchema,
  type WorkPage,
  type WorkReason,
  type WorkSummary,
  workSummarySchema,
} from '@amcore/shared'

import { BadRequestException } from '../../../common/exceptions/index.js'
import { type AiRun, Prisma } from '../../../generated/prisma/client.js'
import { aiExecutionDescriptorSchema } from '../../../infrastructure/ai/registry/ai-execution-descriptor.js'
import { aiRunExecutionEligibility } from '../../../infrastructure/ai/runs/ai-run-execution-eligibility.js'
import { resolveWorkFailure } from '../../../infrastructure/background-work/work-failure.js'
import { PrismaService } from '../../../prisma/index.js'

import { aiRunExecutionsWork } from './ai-run-executions.work.js'
import { AiWorkCleanup } from './ai-work-cleanup.js'
import { aiRunBasicCapability, aiRunRevision, aiRunWorkState, aiWorkDigest } from './ai-work-policy.js'
import { AiWorkRetry } from './ai-work-retry.js'

const buckets: Record<string, string[]> = {
  waiting: ['QUEUED', 'WAITING_APPROVAL', 'WAITING_HUMAN'],
  active: ['RUNNING'],
  delayed: ['QUEUED'],
  failed: ['FAILED'],
  completed: ['COMPLETED', 'CANCELLED', 'EXPIRED'],
  prioritized: [],
}

@Injectable()
export class AiWorkReader {
  constructor(
    private readonly db: PrismaService,
    private readonly retry: AiWorkRetry,
    private readonly cleanup: AiWorkCleanup
  ) {}

  async readSummary(): Promise<WorkSummary> {
    const gate = await this.db.aiRunControl.findUnique({ where: { id: 1 } })
    if (!gate) throw new Error('ai_run_claim_authority_missing')
    const now = await this.clock()
    const predicates: Record<string, Prisma.Sql> = {
      pending: Prisma.sql`status = 'QUEUED'`,
      due: aiRunExecutionEligibility(Prisma.sql`${now}`),
      processing: Prisma.sql`status = 'RUNNING'`,
      failed: Prisma.sql`status = 'FAILED'`,
      completed: Prisma.sql`status IN ('COMPLETED','CANCELLED','EXPIRED')`,
      terminal: Prisma.sql`status IN ('COMPLETED','FAILED','CANCELLED','EXPIRED')`,
      unresolved: Prisma.sql`"terminalReasonCode" = 'tool_effect_unknown' OR EXISTS
        (SELECT 1 FROM ai.ai_tool_invocations ti WHERE ti."runId" = ai_runs.id
          AND ti.status = 'OUTCOME_UNKNOWN')`,
    }
    const queries = Object.entries(predicates).map(
      ([key, predicate]) => Prisma.sql`
      SELECT ${key}::text AS key, count(*)::int AS value FROM (
        SELECT id FROM ai.ai_runs WHERE ${predicate} LIMIT 10001
      ) bounded`
    )
    const counts = await this.db.$queryRaw<{ key: string; value: number }[]>(
      Prisma.join(queries, ' UNION ALL ')
    )
    return workSummarySchema.parse({
      id: aiRunExecutionsWork.id,
      kind: 'durable',
      definitionVersion: 1,
      status: 'available',
      sampledAt: now.toISOString(),
      paused: gate.paused,
      revision: aiWorkDigest([gate.paused, gate.revision]),
      counts: Object.fromEntries(
        counts.map(({ key, value }) => [
          key,
          { value: Math.min(value, 10000), truncated: value > 10000 },
        ])
      ),
      presentation: aiRunExecutionsWork.presentation,
      capabilities: WORK_OPERATIONS.map((operation) => ({
        operation,
        allowed: operation === 'pause' ? !gate.paused : operation === 'resume' ? gate.paused : true,
      })),
    })
  }

  async list(query: WorkListQuery): Promise<WorkPage> {
    const native = query.filters?.status
    if (
      Object.keys(query.filters ?? {}).some((key) => key !== 'status') ||
      (native && !Object.keys(aiRunExecutionsWork.presentation!.nativeStates!).includes(native))
    )
      throw new BadRequestException('Invalid AI work filter')
    const offset = (query.page - 1) * query.limit
    const now = await this.clock()
    const states = (buckets[query.state] ?? []).filter((state) => !native || state === native)
    if (states.length === 0) return this.page([], false, now)
    const rows = await this.db.aiRun.findMany({
      where: {
        status: { in: states as AiRun['status'][] },
        ...(query.state === 'delayed'
          ? { OR: [{ nextAttemptAt: { gt: now } }, { availableAt: { gt: now } }] }
          : {}),
        ...(query.state === 'waiting' && native !== 'WAITING_APPROVAL' && native !== 'WAITING_HUMAN'
          ? {
              OR: [
                { status: { not: 'QUEUED' } },
                {
                  AND: [
                    { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
                    { availableAt: { lte: now } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 513,
    })
    const visible = rows
      .slice(0, 512)
      .filter((row) => !query.search || row.id.toLowerCase().includes(query.search.toLowerCase()))
    const page = visible.slice(offset, offset + query.limit)
    const projected = await Promise.all(
      page.map(async (row) => workListRowSchema.parse(await this.projectWithCapabilities(row, now)))
    )
    return this.page(projected, rows.length > 512, now)
  }

  async detail(id: string): Promise<WorkJob | null> {
    const row = await this.db.aiRun.findUnique({ where: { id } })
    if (!row) return null
    const now = await this.clock()
    const [attempts, oldest, approval] = await Promise.all([
      this.db.aiRunAttempt.findMany({ where: { runId: id }, orderBy: { epoch: 'desc' }, take: 17 }),
      this.db.aiRunAttempt.findFirst({
        where: { runId: id },
        orderBy: { epoch: 'asc' },
        select: { epoch: true },
      }),
      this.db.aiApproval.findFirst({
        where: { runId: id, state: 'PENDING' },
        select: { expiresAt: true },
      }),
    ])
    const effects = await this.db.aiToolInvocation.findMany({
      where: { runId: id, executionEpoch: { in: attempts.slice(0, 16).map((a) => a.epoch) } },
      select: { executionEpoch: true, status: true, idempotency: true, appliedAt: true },
      take: 801,
    })
    const effectFor = (epoch: number): 'unknown' | 'accepted' | 'none' => {
      const selected = effects.filter((effect) => effect.executionEpoch === epoch)
      if (
        effects.length > 800 ||
        selected.some(
          (effect) =>
            ['OUTCOME_UNKNOWN', 'EXECUTING'].includes(effect.status) ||
            (effect.status === 'SUCCEEDED' && !effect.appliedAt)
        )
      )
        return 'unknown'
      return selected.some(
        (effect) => effect.status === 'SUCCEEDED' && effect.idempotency !== 'read_only'
      )
        ? 'accepted'
        : 'none'
    }
    return workJobSchema.parse({
      ...(await this.projectWithCapabilities(row, now, approval?.expiresAt ?? null)),
      history: {
        attempts: attempts.slice(0, 16).map((attempt) => ({
          number: attempt.epoch,
          startedAt: attempt.startedAt.toISOString(),
          ...(attempt.endedAt ? { finishedAt: attempt.endedAt.toISOString() } : {}),
          outcome: attempt.outcome?.toLowerCase() ?? 'active',
          certainty: effectFor(attempt.epoch),
          ...(attempt.errorCode ? { reason: attempt.errorCode.slice(0, 64) } : {}),
        })),
        historyTruncated: attempts.length > 16,
        historyExpired: false,
        ...(oldest ? { oldestRetainedNumber: oldest.epoch } : {}),
      },
    })
  }

  private project(row: AiRun, now: Date, approvalAt: Date | null = null): WorkJob {
    const descriptor = aiExecutionDescriptorSchema.safeParse(row.modelSnapshot)
    const model = descriptor.success ? descriptor.data.modelSlug : 'unavailable'
    const reason = resolveWorkFailure(aiRunExecutionsWork, row.errorCode)
    return {
      identity: { id: row.id, incarnation: row.incarnation, revision: aiRunRevision(row) },
      state: aiRunWorkState(row, now),
      nativeState: row.status,
      jobName: 'ai-run',
      wireVersion: 1,
      sampledAt: now.toISOString(),
      source: 'domain',
      replay: 'durable',
      attemptsStarted: row.leaseEpoch,
      attemptsMade: row.attemptCount,
      manualGrant: row.retryOfRunId ? 'spent' : 'none',
      certainty: row.terminalReasonCode === 'tool_effect_unknown' ? 'unknown' : 'none',
      ...(reason ? { failure: reason } : {}),
      ...(row.nextAttemptAt ? { nextAttemptAt: row.nextAttemptAt.toISOString() } : {}),
      ...(row.cancellationRequestedAt
        ? { cancellationRequestedAt: row.cancellationRequestedAt.toISOString() }
        : {}),
      projection: {
        status: row.status,
        model,
        attempts: row.leaseEpoch,
        lease: row.leaseExpiresAt?.toISOString() ?? '—',
        deadline: row.deadlineAt?.toISOString() ?? '—',
        approval: approvalAt?.toISOString() ?? '—',
        cancel: row.cancellationRequestedAt !== null,
        lineage: row.retryOfRunId ?? '—',
      },
      capabilities: WORK_OPERATIONS.map((operation) => {
        const denial: WorkReason | null = aiRunBasicCapability(row, operation, now)
        return { operation, allowed: denial === null, ...(denial ? { reason: denial } : {}) }
      }),
    }
  }

  private async projectWithCapabilities(
    row: AiRun,
    now: Date,
    approvalAt: Date | null = null
  ): Promise<WorkJob> {
    const result = this.project(row, now, approvalAt)
    const [unknown, accepted, child] = await Promise.all([
      this.db.aiToolInvocation.count({
        where: {
          runId: row.id,
          OR: [
            { status: { in: ['OUTCOME_UNKNOWN', 'EXECUTING'] } },
            { status: 'SUCCEEDED', appliedAt: null },
          ],
        },
      }),
      this.db.aiToolInvocation.count({
        where: {
          runId: row.id,
          status: 'SUCCEEDED',
          appliedAt: { not: null },
          idempotency: { not: 'read_only' },
        },
      }),
      row.retryOfRunId
        ? Promise.resolve(0)
        : this.db.aiRun.count({ where: { retryOfRunId: row.id } }),
    ])
    result.certainty = unknown ? 'unknown' : accepted ? 'accepted' : 'none'
    if (child || row.retryOfRunId) result.manualGrant = 'spent'
    const checks = await Promise.all(
      result.capabilities.map(async (capability) => {
        if (!capability.allowed) return capability
        let reason: WorkReason | null = null
        if (capability.operation === 'retry')
          reason = (await this.retry.check(this.db, row, now)).reason ?? null
        if (capability.operation === 'cleanup') reason = await this.cleanup.check(this.db, row, now)
        return reason ? { ...capability, allowed: false, reason } : capability
      })
    )
    return { ...result, capabilities: checks }
  }

  private page(rows: WorkJob[], windowTruncated: boolean, now: Date): WorkPage {
    return { workId: aiRunExecutionsWork.id, sampledAt: now.toISOString(), rows, windowTruncated }
  }

  private async clock(): Promise<Date> {
    const [row] = await this.db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    return row!.now
  }
}
