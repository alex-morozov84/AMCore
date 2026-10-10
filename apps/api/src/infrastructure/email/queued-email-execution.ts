import { performance } from 'node:perf_hooks'

import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { DelayedError, UnrecoverableError } from 'bullmq'
import { z } from 'zod'

import { readBoundedJob } from '../background-work/bounded-job-reader'
import { ControlConnection } from '../background-work/control-connection'
import { managedJobKey } from '../background-work/managed-job-key'
import { parseManagedJob } from '../background-work/managed-job-profile'
import { PgOutcomeBuffer } from '../background-work/pg-outcome-buffer'
import { preparedBody } from '../background-work/prepared-body.store'
import {
  type ProviderAttempt,
  ProviderEvidenceStore,
  type ProviderOutcome,
  type ProviderOutcomeWitness,
} from '../background-work/provider-evidence.store'
import { readQueueSnapshot } from '../background-work/queue-snapshot'
import { reportManagedInvocation } from '../background-work/scripts/invocation-report'
import { deferProviderCooldown } from '../background-work/scripts/provider-defer'
import { fenceProviderAttempt } from '../background-work/scripts/provider-fence'
import type {
  WorkDefinition,
  WorkHandler,
  WorkInvocation,
} from '../background-work/work-definition'
import type { ProviderWindowExecution } from '../background-work/work-execution.service'
import {
  isPermanentWorkFailure,
  WorkFailure,
  workFailureCode,
} from '../background-work/work-failure'
import { WorkPolicyError } from '../background-work/work-policy-error'
import { WorkReadiness } from '../background-work/work-readiness'

import { type EmailProvider, EmailTemplate, SECRET_EMAIL_TEMPLATES } from './email.types'
import { applyLegacyQueuedEmail, prepareLegacyQueuedEmail } from './legacy-queued-email'
import type { QueuedEmailOutcome } from './queued-email-provider'
import {
  type QueuedTransportFence,
  sampleLocalClock,
  sendFrozenQueuedEmail,
} from './queued-email-transport'

import { type EmailMetricsTemplate, MetricsService } from '@/infrastructure/observability'

const pendingSchema = z.strictObject({
  workId: z.string().min(1).max(64),
  incarnation: z.uuidv7(),
  attemptId: z.uuidv7(),
  revision: z.number().int().positive(),
  outcome: z.strictObject({
    certainty: z.enum(['none', 'accepted', 'unknown']),
    code: z.enum([
      'COMPLETED',
      'RATE_LIMITED',
      'TRANSIENT_FAILURE',
      'PERMANENT_FAILURE',
      'NO_CALL',
    ]),
    retryAfter: z
      .discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('duration'),
          milliseconds: z.number().int().nonnegative(),
        }),
        z.strictObject({ kind: z.literal('absolute'), timestamp: z.number().int().nonnegative() }),
        z.strictObject({ kind: z.literal('unsupported') }),
      ])
      .optional(),
  }),
  witness: z.strictObject({
    attemptId: z.uuidv7(),
    incarnation: z.uuidv7(),
    kind: z.enum(['reported', 'denied-before-call']),
    brokerRevision: z.number().int().positive().optional(),
  }),
})

/** Approved queued-email policy. Ordinary idempotent handlers do not enter this PG safety owner. */
@Injectable()
export class QueuedEmailExecution implements ProviderWindowExecution, OnModuleInit {
  constructor(
    @Inject('EmailProvider') private readonly email: EmailProvider,
    private readonly evidence: ProviderEvidenceStore,
    private readonly control: ControlConnection,
    private readonly buffer: PgOutcomeBuffer,
    private readonly readiness: WorkReadiness,
    @Optional() private readonly metrics?: MetricsService
  ) {}

  discardSecret(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false
    const record = data as Record<string, unknown>
    const input = record.protocolVersion === 1 ? record.payload : data
    if (!input || typeof input !== 'object') return false
    const template = (input as Record<string, unknown>).template
    const discarded =
      typeof template === 'string' && SECRET_EMAIL_TEMPLATES.has(template as EmailTemplate)
    if (discarded) this.observeProcess(input, 'discarded', false, performance.now())
    return discarded
  }

  async prepareLegacy(
    definition: WorkDefinition,
    queue: Queue,
    job: Job,
    token: string
  ): Promise<void> {
    const result = await this.control.withClient((client) =>
      prepareLegacyQueuedEmail(client, definition, queue, job, token)
    )
    if (result.unknown) {
      // Independent old-effect evidence commits BEFORE changing the broker hash, outside a Redis lease.
      await this.quarantineLegacy(
        definition,
        { id: job.id, name: job.name, data: result.envelope, opts: result.options },
        result.queueEpoch,
        result.starts
      )
    }
    await this.control.withClient((client) => applyLegacyQueuedEmail(client, queue, job, result))
    if (result.unknown) throw new UnrecoverableError('EFFECT_UNKNOWN')
  }

  private quarantineLegacy(
    definition: WorkDefinition,
    job: Pick<Job, 'id' | 'name' | 'data' | 'opts'>,
    queueEpoch: string,
    starts: number
  ): Promise<void> {
    return this.evidence.quarantineLegacy(
      {
        workId: definition.id,
        jobId: job.id!,
        queueEpoch,
        incarnation: z.uuidv7().parse(job.data.incarnation),
        jobName: job.name,
        wireVersion: definition.jobs[job.name]!.wireVersion,
        policyVersion: definition.jobs[job.name]!.replay.policyVersion,
        automaticLimit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .parse(job.opts.attempts ?? 3),
        evidenceRevision: null,
      },
      starts
    )
  }

  onModuleInit(): void {
    this.buffer.register('provider', async (payload) => {
      const value = pendingSchema.parse(payload)
      const row = await this.evidence.read(value.workId, value.incarnation)
      if (!row) throw new WorkPolicyError('OUTCOME_UNRECORDED')
      await this.evidence.finalize(
        {
          row: { ...row, revision: value.revision },
          attemptId: value.attemptId,
          pgTime: 0,
          mode: 'automatic',
        },
        value.outcome,
        value.witness
      )
    })
  }

  async run(
    definition: WorkDefinition,
    queue: Queue,
    job: Job,
    token: string,
    payload: unknown,
    handler: WorkHandler
  ): Promise<void> {
    const startedAt = performance.now()
    try {
      this.readiness.assertReady()
      if (!this.email.queuedEmail || !handler.prepareRequest)
        throw new UnrecoverableError('ACTION_UNAVAILABLE')
      await this.execute(definition, queue, job, token, payload, handler)
      this.observeProcess(payload, 'success', undefined, startedAt)
    } catch (error) {
      // A cooldown deferral has no business attempt/result, and is not a failed send.
      if (!(error instanceof DelayedError))
        this.observeProcess(payload, 'error', !isPermanentWorkFailure(error), startedAt)
      if (error instanceof WorkFailure) {
        if (error.permanent) throw new UnrecoverableError('PERMANENT_FAILURE')
        throw new Error('TRANSIENT_FAILURE')
      }
      throw error
    }
  }

  private observeProcess(
    payload: unknown,
    result: 'success' | 'error' | 'discarded',
    retryable: boolean | undefined,
    startedAt: number
  ): void {
    const raw =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>).template
        : undefined
    const template: EmailMetricsTemplate =
      typeof raw === 'string' && Object.values(EmailTemplate).includes(raw as EmailTemplate)
        ? (raw as EmailMetricsTemplate)
        : 'unknown'
    this.metrics?.observeEmailOperation(
      {
        template,
        operation: 'process',
        mode: 'worker',
        result,
        retryable: retryable === undefined ? 'unknown' : retryable ? 'true' : 'false',
      },
      (performance.now() - startedAt) / 1000
    )
  }

  private async execute(
    definition: WorkDefinition,
    queue: Queue,
    job: Job,
    token: string,
    payload: unknown,
    handler: WorkHandler
  ): Promise<void> {
    const provider = this.email.queuedEmail!
    const key = managedJobKey(queue, job.id!)
    const observation = await this.control.withClient((client) => readBoundedJob(client, key))
    if (observation.status !== 'observed') throw new UnrecoverableError(observation.reason)
    const { envelope } = parseManagedJob(definition, observation.fields)
    if (
      observation.fields.name !== job.name ||
      envelope.incarnation !== job.data?.incarnation ||
      envelope.jobVersion !== job.data?.jobVersion ||
      envelope.executionPolicyVersion !== job.data?.executionPolicyVersion
    )
      throw new UnrecoverableError('STATE_CHANGED')
    if (observation.fields.amLegacyRequestUnknown) {
      if (observation.fields.amLegacyRequestUnknown !== '1')
        throw new UnrecoverableError('CONTENT_UNSUPPORTED')
      const state = await this.control.withClient((client) =>
        readQueueSnapshot(client, queue.toKey(''))
      )
      if (state.status !== 'observed') throw new UnrecoverableError(state.reason)
      await this.quarantineLegacy(
        definition,
        job,
        state.snapshot.epoch,
        Number(observation.fields.ats)
      )
      throw new UnrecoverableError('EFFECT_UNKNOWN')
    }
    const existing = await this.evidence.read(definition.id, envelope.incarnation)
    if (!existing && observation.fields.amEvidenceInitialized)
      throw new UnrecoverableError('OUTCOME_UNRECORDED')
    if (existing?.certainty === 'accepted') return
    if (existing && !existing.outcomeRecorded) throw new UnrecoverableError('OUTCOME_UNRECORDED')
    if (existing?.floorUpper && existing.nominalDeadline) {
      const deferred = await this.control.withClient((client) =>
        deferProviderCooldown(client, queue, {
          id: job.id!,
          lockToken: token,
          incarnation: envelope.incarnation,
          revision: Number(observation.fields.amRevision ?? 0),
          floorUpper: Number(existing!.floorUpper),
          nominalDeadline: existing.nominalDeadline!.getTime(),
        })
      )
      if (deferred === 'deferred') throw new DelayedError()
      if (deferred !== 'eligible') throw new UnrecoverableError(deferred.reason)
    }
    const scope = provider.scope()
    const identity = { incarnation: envelope.incarnation, lockToken: token, providerScope: scope }
    const context: WorkInvocation = {
      workId: definition.id,
      jobId: job.id!,
      incarnation: envelope.incarnation,
      invocationId: envelope.incarnation,
      signal: this.readiness.signal,
    }
    let request = await this.control.withClient((client) =>
      preparedBody(client, queue, job.id!, identity)
    )
    if (request.status === 'missing') {
      if (existing && !this.evidence.canPrepare(existing))
        throw new UnrecoverableError('REQUEST_EXPIRED')
      const rendered = await handler.prepareRequest!(payload, context)
      request = await this.control.withClient((client) =>
        preparedBody(client, queue, job.id!, identity, rendered)
      )
    }
    if (request.status !== 'prepared')
      throw new UnrecoverableError(
        request.status === 'unavailable' ? request.reason : 'REQUEST_EXPIRED'
      )
    const frozenBody = request.body
    const queueState = await this.control.withClient((client) =>
      readQueueSnapshot(client, queue.toKey(''))
    )
    if (queueState.status !== 'observed') throw new UnrecoverableError(queueState.reason)
    let beforePg = sampleLocalClock()
    const reservation = await this.evidence
      .reserve({
        workId: definition.id,
        incarnation: envelope.incarnation,
        queueEpoch: queueState.snapshot.epoch,
        jobId: job.id!,
        jobName: job.name,
        wireVersion: envelope.jobVersion,
        policyVersion: envelope.executionPolicyVersion,
        automaticLimit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .parse(job.opts.attempts ?? 3),
        requestDigest: request.digest,
        providerScope: scope,
        manualCommandId: observation.fields.amManualCommandId ?? undefined,
      })
      .catch(async (error: unknown) => {
        if (
          !(error instanceof WorkPolicyError) ||
          error.reason !== 'COMMAND_CONFLICT' ||
          !existing?.nominalDeadline ||
          existing.manualGrant !== 'reserved' ||
          existing.commandFence !== observation.fields.amManualCommandId
        )
          throw error
        const deferred = await this.control.withClient((client) =>
          deferProviderCooldown(client, queue, {
            id: job.id!,
            lockToken: token,
            incarnation: envelope.incarnation,
            revision: Number(observation.fields.amRevision ?? 0),
            floorUpper: Number(existing.floorUpper),
            nominalDeadline: existing.nominalDeadline!.getTime(),
            commandId: existing.commandFence!,
          })
        )
        if (deferred === 'deferred') throw new DelayedError()
        throw new UnrecoverableError(deferred === 'eligible' ? 'COMMAND_CONFLICT' : deferred.reason)
      })
    if ('accepted' in reservation) return
    let attempt = reservation
    let revision = Number(observation.fields.amRevision ?? 0)
    const fence = async (refresh: boolean): Promise<QueuedTransportFence> => {
      if (refresh) {
        beforePg = sampleLocalClock()
        attempt = await this.evidence.refence(attempt)
      }
      const beforeEval = sampleLocalClock()
      // No provider invocation has occurred in this branch. Even an ambiguous
      // Redis fence cannot create a remote effect; persist that local witness.
      let result: Awaited<ReturnType<typeof fenceProviderAttempt>>
      try {
        result = await this.control.withClient((client) =>
          fenceProviderAttempt(client, key, queue.toKey('meta'), token, revision, attempt, refresh)
        )
      } catch {
        await this.persist(
          attempt,
          { certainty: 'none', code: 'NO_CALL' },
          {
            incarnation: envelope.incarnation,
            attemptId: attempt.attemptId,
            kind: 'denied-before-call',
          }
        )
        throw new UnrecoverableError('WORK_UNAVAILABLE')
      }
      if (result.status !== 'fenced') {
        await this.persist(
          attempt,
          { certainty: 'none', code: 'NO_CALL' },
          {
            incarnation: envelope.incarnation,
            attemptId: attempt.attemptId,
            kind: 'denied-before-call',
          }
        )
        throw new UnrecoverableError(result.reason)
      }
      revision = result.revision
      return {
        redisTime: result.redisTime,
        pgTime: attempt.pgTime,
        beforeEval,
        beforePg,
        nominalDeadline: attempt.row.nominalDeadline!.getTime(),
        floorUpper: Number(attempt.row.floorUpper),
      }
    }
    const initialFence = await fence(false)
    let outcome: QueuedEmailOutcome | undefined
    let attempted = false
    let handlerFailure: WorkFailure | undefined
    try {
      await handler.run(payload, {
        ...context,
        invocationId: attempt.attemptId,
        effect: {
          send: async () => {
            if (attempted) throw new UnrecoverableError('OUTCOME_UNRECORDED')
            attempted = true
            const result = await sendFrozenQueuedEmail(
              provider,
              frozenBody,
              `email:${envelope.incarnation}`,
              scope,
              initialFence,
              () => fence(true)
            )
            if (result.status === 'not-called') {
              await this.persist(
                attempt,
                { certainty: 'none', code: 'NO_CALL' },
                {
                  incarnation: envelope.incarnation,
                  attemptId: attempt.attemptId,
                  kind: 'denied-before-call',
                }
              )
              throw new UnrecoverableError(result.reason)
            }
            outcome = result.outcome
          },
        },
      })
    } catch (error) {
      if (!(error instanceof WorkFailure)) throw error
      // A diagnosis never manufactures a provider outcome after an ambiguous call.
      if (attempted && !outcome) throw error
      handlerFailure = error
      if (!outcome)
        outcome = {
          certainty: 'none',
          retryable: !error.permanent,
          code: error.permanent ? 'PERMANENT_FAILURE' : 'TRANSIENT_FAILURE',
        }
    }
    if (!outcome) throw new UnrecoverableError('OUTCOME_UNRECORDED')
    const witness = await this.control.withClient((client) =>
      reportManagedInvocation(client, key, {
        incarnation: envelope.incarnation,
        invocationId: attempt.attemptId,
        revision,
        lockToken: token,
        report: !handlerFailure && outcome!.certainty === 'accepted' ? 'success' : 'failure',
        code: handlerFailure
          ? handlerFailure.permanent
            ? 'PERMANENT_FAILURE'
            : 'TRANSIENT_FAILURE'
          : outcome!.code,
        failureCode: handlerFailure ? workFailureCode(definition, handlerFailure) : undefined,
      })
    )
    if (!witness.recorded) throw new UnrecoverableError('OUTCOME_UNRECORDED')
    await this.persist(attempt, outcome, {
      incarnation: envelope.incarnation,
      attemptId: attempt.attemptId,
      kind: 'reported',
      brokerRevision: witness.revision,
    })
    if (handlerFailure) throw handlerFailure
    if (outcome.certainty !== 'accepted') {
      if (!outcome.retryable) throw new UnrecoverableError(outcome.code)
      throw new Error(outcome.code)
    }
  }

  private async persist(
    attempt: ProviderAttempt,
    outcome: ProviderOutcome,
    witness: ProviderOutcomeWitness
  ): Promise<void> {
    try {
      await this.evidence.finalize(attempt, outcome, witness)
    } catch {
      const payload = pendingSchema.parse({
        workId: attempt.row.workId,
        incarnation: attempt.row.incarnation,
        attemptId: attempt.attemptId,
        revision: attempt.row.revision,
        outcome: {
          certainty: outcome.certainty,
          code: outcome.code,
          ...(outcome.retryAfter ? { retryAfter: outcome.retryAfter } : {}),
        },
        witness,
      })
      this.buffer.enqueue('provider', `${attempt.row.workId}:${attempt.attemptId}`, payload)
      throw new UnrecoverableError('OUTCOME_UNRECORDED')
    }
  }
}
