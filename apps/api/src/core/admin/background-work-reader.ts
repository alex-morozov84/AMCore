import { Inject, Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import type { Queue } from 'bullmq'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

import {
  type RequestPrincipal,
  WORK_OPERATIONS,
  type WorkJob,
  workJobSchema,
  type WorkListQuery,
  workListQuerySchema,
  workListRowSchema,
  type WorkPage,
  workPageSchema,
  type WorkReason,
  workReasonSchema,
} from '@amcore/shared'

import { BackgroundControlAuthority } from './background-control-authority'
import { BackgroundControlBudgets } from './background-control-budgets'
import { backgroundControlError } from './background-control-error'

import { ControlConnection } from '@/infrastructure/background-work/control-connection'
import { backgroundControlTransaction } from '@/infrastructure/background-work/control-transaction'
import type { DurableWorkReader } from '@/infrastructure/background-work/durable-work'
import {
  type JobSnapshot,
  providerTargetRevision,
  readJobSnapshot,
} from '@/infrastructure/background-work/job-snapshot'
import { parseManagedJob } from '@/infrastructure/background-work/managed-job-profile'
import { ProviderEvidenceStore } from '@/infrastructure/background-work/provider-evidence.store'
import { readQueueSnapshot } from '@/infrastructure/background-work/queue-snapshot'
import { WORK_REGISTRATIONS } from '@/infrastructure/background-work/registration'
import {
  applyIdempotentCommand,
  applyProviderWindowCommand,
} from '@/infrastructure/background-work/scripts/idempotent-command'
import { readJobWindow } from '@/infrastructure/background-work/scripts/job-window'
import type {
  WorkDefinition,
  WorkRegistration,
} from '@/infrastructure/background-work/work-definition'
import { currentWorkFailure } from '@/infrastructure/background-work/work-failure'
import type { EmailProvider } from '@/infrastructure/email/email.types'
import { QUEUE_REGISTRY } from '@/infrastructure/queue/constants/queue-inventory.constant'
import { PrismaService } from '@/prisma'

/** Same registration and bounded projection for every native job list/detail. */
@Injectable()
export class BackgroundWorkReader {
  constructor(
    @Inject(WORK_REGISTRATIONS) private readonly entries: readonly WorkRegistration[],
    @Inject(QUEUE_REGISTRY) private readonly queues: ReadonlyMap<string, Queue>,
    private readonly modules: ModuleRef,
    private readonly prisma: PrismaService,
    private readonly connection: ControlConnection,
    private readonly authority: BackgroundControlAuthority,
    private readonly budgets: BackgroundControlBudgets
  ) {}

  async list(principal: RequestPrincipal, workId: string, input: WorkListQuery): Promise<WorkPage> {
    const query = workListQuerySchema.parse(input)
    await this.admitRead(principal)
    const definition = this.definition(workId)
    if (query.source === 'PG_evidence') return this.evidencePage(definition, query)
    if (definition.kind === 'durable') {
      const reader = this.modules.get<DurableWorkReader>(definition.tokens.reader, {
        strict: false,
      })
      return this.validatePage(workId, await reader.list(query))
    }
    const queue = this.queue(definition)
    const window = await this.connection.withClient(async (client) => {
      const observed = await readQueueSnapshot(client, queue.toKey(''))
      if (observed.status !== 'observed') return { reason: workReasonSchema.parse(observed.reason) }
      if (observed.snapshot.layout === 'legacy-mixed')
        return { reason: 'LEGACY_MIGRATION_REQUIRED' as const }
      return readJobWindow(client, queue, query, observed.snapshot.layout === 'legacy-paused-only')
    })
    const page: WorkPage = {
      workId,
      sampledAt: new Date().toISOString(),
      rows: [],
      windowTruncated: false,
    }
    if ('reason' in window) return { ...page, reason: window.reason }
    const rows: WorkJob[] = []
    let remaining = 512 * 1024
    let reason: WorkReason | undefined
    const deadline = performance.now() + 5000
    for (let offset = 0; offset < window.ids.length;) {
      const count = Math.min(4, Math.floor(remaining / 65536), window.ids.length - offset)
      if (!count || performance.now() >= deadline) {
        reason = 'READ_LIMIT'
        break
      }
      // Reserve the worst-case aggregate before launching bounded concurrent reads.
      remaining -= count * 65536
      const batch = window.ids.slice(offset, offset + count)
      offset += count
      const results = await Promise.all(
        batch.map(async (id) => {
          const result = await this.connection.withClient((client) =>
            readJobSnapshot(client, queue, id)
          )
          if (result.status !== 'observed')
            return { bytes: 0, reason: workReasonSchema.parse(result.reason) }
          try {
            return {
              bytes: result.snapshot.raw.bytes,
              row: await this.project(definition, queue, id, result.snapshot, deadline),
            }
          } catch {
            return { bytes: result.snapshot.raw.bytes, reason: 'CONTENT_UNSUPPORTED' as const }
          }
        })
      )
      for (const result of results) {
        remaining += 65536 - result.bytes
        if (result.row) rows.push(result.row)
        if (result.reason) reason = result.reason
      }
    }
    return this.validatePage(workId, {
      ...page,
      rows,
      windowTruncated: window.truncated || reason !== undefined,
      ...(reason ? { reason } : {}),
    })
  }

  async detail(principal: RequestPrincipal, workId: string, id: string): Promise<WorkJob | null> {
    await this.admitRead(principal)
    const definition = this.definition(workId)
    if (definition.kind === 'durable') {
      const reader = this.modules.get<DurableWorkReader>(definition.tokens.reader, {
        strict: false,
      })
      const result = await reader.detail(id)
      return result ? this.validateJob(result) : null
    }
    const queue = this.queue(definition)
    const observed = await this.connection.withClient((client) =>
      readJobSnapshot(client, queue, id)
    )
    if (observed.status !== 'observed') {
      if (observed.reason === 'HISTORY_EXPIRED') return null
      throw backgroundControlError(workReasonSchema.parse(observed.reason))
    }
    return this.validateJob(await this.project(definition, queue, id, observed.snapshot))
  }

  private async project(
    definition: WorkDefinition,
    queue: Queue,
    id: string,
    snapshot: JobSnapshot,
    deadline = performance.now() + 5000
  ): Promise<WorkJob> {
    const { envelope, binding, payload } = parseManagedJob(definition, snapshot.raw.fields)
    const projection = z
      .record(
        z.string().min(1).max(64),
        z.union([z.string().max(256), z.number().finite(), z.boolean()])
      )
      .parse(binding.project(payload))
    if (Object.keys(projection).length > 8 || Buffer.byteLength(JSON.stringify(projection)) > 2048)
      throw backgroundControlError('CONTENT_UNSUPPORTED')
    const evidence =
      binding.replay.kind === 'provider-window'
        ? this.modules.get(ProviderEvidenceStore, { strict: false })
        : undefined
    const provider = evidence
      ? await evidence.observe(definition.id, envelope.incarnation)
      : undefined
    const capabilities = []
    for (const operation of WORK_OPERATIONS) {
      let reason: WorkReason | undefined = 'ACTION_UNAVAILABLE'
      if (
        definition.kind === 'ordinary' &&
        binding.replay.kind !== 'unsupported' &&
        operation !== 'pause' &&
        operation !== 'resume'
      ) {
        const minimumAgeMs =
          snapshot.state === 'completed'
            ? binding.retention.completedMs
            : binding.retention.failedMs
        if (performance.now() >= deadline) reason = 'READ_LIMIT'
        else if (
          operation !== 'cleanup' ||
          snapshot.state === 'completed' ||
          snapshot.state === 'failed'
        ) {
          if (provider) {
            reason =
              !provider.row && snapshot.raw.fields.amEvidenceInitialized === '1'
                ? 'OUTCOME_UNRECORDED'
                : evidence!.controlReason(provider.row, operation, provider.now)
            const transport = this.modules.get<EmailProvider>('EmailProvider', {
              strict: false,
            }).queuedEmail
            if (!transport) reason = 'ACTION_UNAVAILABLE'
            else if (operation === 'retry' && provider.row?.providerScope !== transport.scope())
              reason = 'PROVIDER_CHANGED'
          } else reason = undefined
          const request = {
            id,
            fingerprint: snapshot.fingerprint,
            operation,
            incarnation: envelope.incarnation,
            wireVersion: envelope.jobVersion,
            policyVersion: envelope.executionPolicyVersion,
            admittedAt: snapshot.sampledAt,
            dispatchNotAfter: snapshot.sampledAt + 5000,
            commandId: uuidv7(),
            dispatchId: uuidv7(),
            ...(operation === 'cleanup'
              ? {
                  cleanup: {
                    cutoff: snapshot.sampledAt - minimumAgeMs,
                    minimumAgeMs,
                    state: snapshot.state as 'completed' | 'failed',
                  },
                }
              : {}),
          }
          if (!reason) {
            const result = await this.connection.withClient((client) =>
              provider
                ? applyProviderWindowCommand(
                    client,
                    queue,
                    request,
                    {
                      revision: (provider.row?.revision ?? 0) + 1,
                      digest: provider.row?.requestDigest ?? null,
                      scope: provider.row?.providerScope ?? null,
                      nominalDeadline: provider.row?.nominalDeadline?.getTime() ?? null,
                      floorUpper: Number(provider.row?.floorUpper ?? 0),
                    },
                    true
                  )
                : applyIdempotentCommand(client, queue, request, true)
            )
            reason = result.status === 'rejected' ? result.reason : undefined
          }
        }
      }
      capabilities.push({ operation, allowed: reason === undefined, ...(reason ? { reason } : {}) })
    }
    const fields = snapshot.raw.fields
    const metadata = fields.amMetadata
      ? z
          .object({ report: z.enum(['success', 'failure', 'unrecorded']) })
          .parse(JSON.parse(fields.amMetadata))
      : undefined
    return this.validateJob({
      identity: {
        id,
        incarnation: envelope.incarnation,
        revision: provider
          ? providerTargetRevision(snapshot.revision, provider.row?.revision ?? null)
          : snapshot.revision,
      },
      failure: currentWorkFailure(definition, snapshot.state, envelope.incarnation, fields),
      state: snapshot.state,
      jobName: fields.name,
      wireVersion: envelope.jobVersion,
      sampledAt: new Date(snapshot.sampledAt).toISOString(),
      source: 'broker',
      replay: binding.replay.kind,
      report:
        provider?.row && !provider.row.outcomeRecorded
          ? 'unrecorded'
          : (metadata?.report ?? 'none'),
      ...(provider?.row ? { certainty: provider.row.certainty } : {}),
      attemptsStarted: Number(fields.ats ?? 0),
      attemptsMade: Number(fields.atm ?? 0),
      manualGrant: provider?.row?.manualGrant ?? fields.amManualGrant ?? 'none',
      projection,
      capabilities,
    })
  }

  private admitRead(principal: RequestPrincipal): Promise<void> {
    return backgroundControlTransaction(this.prisma, async (ctx) => {
      const rows = await this.budgets.lock(ctx, principal.sub)
      await this.authority.assert(ctx, principal, false)
      await this.budgets.request(ctx, rows, true)
    })
  }

  /** Independent safety evidence; broker state and attempt completions are deliberately unobserved. */
  private async evidencePage(definition: WorkDefinition, query: WorkListQuery): Promise<WorkPage> {
    if (!Object.values(definition.jobs).some((job) => job.replay.kind === 'provider-window'))
      throw backgroundControlError('ACTION_UNAVAILABLE')
    const store = this.modules.get(ProviderEvidenceStore, { strict: false })
    return backgroundControlTransaction(this.prisma, async (ctx) => {
      const window = await ctx.tx.backgroundEffectEvidence.findMany({
        where: { workId: definition.id },
        orderBy: [{ createdAt: 'asc' }, { incarnation: 'asc' }],
        take: 513,
        select: { incarnation: true },
      })
      const selected = window
        .slice(0, 512)
        .slice((query.page - 1) * query.limit, query.page * query.limit)
      const evidence = selected.length
        ? await ctx.tx.backgroundEffectEvidence.findMany({
            where: {
              workId: definition.id,
              incarnation: { in: selected.map((row) => row.incarnation) },
            },
            orderBy: [{ createdAt: 'asc' }, { incarnation: 'asc' }],
            take: query.limit,
          })
        : []
      return this.validatePage(definition.id, {
        workId: definition.id,
        sampledAt: ctx.now.toISOString(),
        windowTruncated: window.length > 512,
        rows: evidence.map((row) =>
          this.validateJob({
            identity: {
              id: row.jobId,
              incarnation: row.incarnation,
              revision: providerTargetRevision('PG_evidence', row.revision),
            },
            state: 'unavailable',
            jobName: row.jobName,
            wireVersion: row.wireVersion,
            sampledAt: ctx.now.toISOString(),
            source: 'PG_evidence',
            replay: 'provider-window',
            report: row.outcomeRecorded ? 'none' : 'unrecorded',
            certainty: row.certainty,
            attemptsStarted: row.autoStartsUsed + (row.manualGrant === 'spent' ? 1 : 0),
            manualGrant: row.manualGrant,
            projection: {
              evidenceRevision: row.revision,
              automaticLimit: row.automaticLimit,
              outcomeRecorded: row.outcomeRecorded,
              unresolvedCalls: row.unresolvedCount,
              floorUpper: row.floorUpper.toString(),
              disposition: row.disposition,
              ...(row.firstDispatchAt
                ? { firstDispatchAt: row.firstDispatchAt.toISOString() }
                : {}),
              ...(row.nominalDeadline
                ? { nominalDeadline: row.nominalDeadline.toISOString() }
                : {}),
            },
            reconciliation: {
              revision: row.revision,
              allowed: store.dispositionReason(row, ctx.now.getTime()) === undefined,
              ...(store.dispositionReason(row, ctx.now.getTime())
                ? { reason: store.dispositionReason(row, ctx.now.getTime()) }
                : {}),
            },
            capabilities: WORK_OPERATIONS.map((operation) => ({
              operation,
              allowed: false,
              reason:
                row.certainty === 'unknown' || !row.outcomeRecorded
                  ? 'EFFECT_UNKNOWN'
                  : 'METADATA_UNAVAILABLE',
            })),
          })
        ),
      })
    })
  }

  private definition(id: string): WorkDefinition {
    const definition = this.entries.find((entry) => entry.definition.id === id)?.definition
    if (!definition || (definition.queue && !definition.queue.enabled))
      throw backgroundControlError('WORK_UNAVAILABLE')
    return definition
  }

  private queue(definition: WorkDefinition): Queue {
    const queue = definition.queue && this.queues.get(definition.queue.name)
    if (!queue) throw backgroundControlError('WORK_UNAVAILABLE')
    return queue
  }

  private validateJob(value: unknown): WorkJob {
    const parsed = workJobSchema.safeParse(value)
    if (!parsed.success) throw backgroundControlError('READ_LIMIT')
    const row = parsed.data
    return row
  }

  private validatePage(workId: string, value: unknown): WorkPage {
    const parsed = workPageSchema.safeParse(value)
    if (!parsed.success) throw backgroundControlError('READ_LIMIT')
    const page = parsed.data
    if (page.workId !== workId) throw backgroundControlError('READ_LIMIT')
    page.rows.forEach((row) => workListRowSchema.parse(row))
    return page
  }
}
