import { createHash } from 'node:crypto'

import { Inject, Injectable, Optional } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import { UnrecoverableError } from 'bullmq'
import type { Redis } from 'ioredis'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

import { readBoundedJob } from './bounded-job-reader'
import { managedJobKey } from './managed-job-key'
import { parseManagedJob } from './managed-job-profile'
import { startIdempotentInvocation } from './scripts/idempotent-start'
import { reportManagedInvocation } from './scripts/invocation-report'
import {
  jobVersions,
  type WorkDefinition,
  type WorkHandler,
  type WorkInvocation,
} from './work-definition'
import { isPermanentWorkFailure, workFailureCode } from './work-failure'
import { parseWorkPayload } from './work-payload'
import { WorkReadiness } from './work-readiness'

export const PROVIDER_WINDOW_EXECUTION = Symbol('PROVIDER_WINDOW_EXECUTION')
export interface ProviderWindowExecution {
  /** Closed recipe compatibility: secret-bearing queued input completes without rendering or sending. */
  discardSecret?(data: unknown): boolean
  prepareLegacy?(definition: WorkDefinition, queue: Queue, job: Job, token: string): Promise<void>
  run(
    definition: WorkDefinition,
    queue: Queue,
    job: Job,
    token: string,
    payload: unknown,
    handler: WorkHandler
  ): Promise<void>
}

const envelopeSchema = z.strictObject({
  protocolVersion: z.literal(1),
  incarnation: z.uuidv7(),
  jobVersion: z.number().int().positive(),
  executionPolicyVersion: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  payload: z.unknown(),
})

/** Shared execution entry; policy-local admission precedes every business handler. */
@Injectable()
export class WorkExecutionService {
  constructor(
    private readonly readiness: WorkReadiness,
    @Optional()
    @Inject(PROVIDER_WINDOW_EXECUTION)
    private readonly providerWindow?: ProviderWindowExecution
  ) {}

  discardSecret(definition: WorkDefinition, job: Job): boolean {
    this.readiness.assertReady()
    return (
      definition.jobs[job.name]?.replay.kind === 'provider-window' &&
      this.providerWindow?.discardSecret?.(job.data) === true
    )
  }

  async run(
    definition: WorkDefinition,
    queue: Queue,
    job: Job,
    token: string,
    handler: WorkHandler
  ): Promise<void> {
    this.readiness.assertReady()
    const binding = definition.jobs[job.name]
    if (!binding) throw new UnrecoverableError('VERSION_UNSUPPORTED')
    if (this.discardSecret(definition, job)) return
    if (
      binding.replay.kind === 'provider-window' &&
      this.providerWindow?.prepareLegacy &&
      (!job.data || typeof job.data !== 'object' || !('protocolVersion' in job.data))
    )
      await this.providerWindow.prepareLegacy(definition, queue, job, token)
    const envelope = envelopeSchema.safeParse(job.data)
    if (!envelope.success) {
      if (
        definition.kind === 'wake' &&
        definition.legacy?.kind === 'wake-hint' &&
        (!job.data || typeof job.data !== 'object' || !('protocolVersion' in job.data)) &&
        handler.runLegacyWake
      ) {
        await handler.runLegacyWake()
        return
      }
      throw new UnrecoverableError('VERSION_UNSUPPORTED')
    }
    const version = jobVersions(binding).find(
      (entry) => entry.wireVersion === envelope.data.jobVersion
    )
    if (!version || envelope.data.executionPolicyVersion !== binding.replay.policyVersion)
      throw new UnrecoverableError('VERSION_UNSUPPORTED')
    let payload: unknown
    try {
      payload = parseWorkPayload(version, envelope.data.payload)
    } catch {
      throw new UnrecoverableError('VERSION_UNSUPPORTED')
    }
    if (definition.kind === 'wake') {
      await handler.run(payload, this.context(definition, job, envelope.data.incarnation, uuidv7()))
      return
    }
    if (binding.replay.kind === 'provider-window') {
      if (!this.providerWindow) throw new UnrecoverableError('ACTION_UNAVAILABLE')
      return this.providerWindow.run(definition, queue, job, token, payload, handler)
    }
    if (binding.replay.kind !== 'idempotent') throw new UnrecoverableError('ACTION_UNAVAILABLE')
    return this.runIdempotent(definition, queue, job, token, envelope.data, payload, handler)
  }

  private async runIdempotent(
    definition: WorkDefinition,
    queue: Queue,
    job: Job,
    token: string,
    envelope: z.infer<typeof envelopeSchema>,
    payload: unknown,
    handler: WorkHandler
  ): Promise<void> {
    const client = (await queue.getBackend().client) as unknown as Redis
    const key = managedJobKey(queue, job.id!)
    const observation = await readBoundedJob(client, key)
    if (observation.status !== 'observed') throw new UnrecoverableError(observation.reason)
    const profile = parseManagedJob(definition, observation.fields)
    if (JSON.stringify(profile.envelope) !== JSON.stringify(job.data))
      throw new UnrecoverableError('STATE_CHANGED')
    const witness = await startIdempotentInvocation(client, key, {
      dataFingerprint: createHash('sha1').update(observation.fields.data!).digest('hex'),
      optionsFingerprint: createHash('sha1').update(observation.fields.opts!).digest('hex'),
      incarnation: envelope.incarnation,
      policyVersion: envelope.executionPolicyVersion,
      wireVersion: envelope.jobVersion,
      revision: Number(observation.fields.amRevision ?? 0),
      lockToken: token,
      manualCommandId: observation.fields.amManualCommandId ?? undefined,
      manualDispatchId: observation.fields.amManualDispatchId ?? undefined,
    })
    if (witness.status !== 'started') throw new UnrecoverableError(witness.reason)
    const identity = {
      incarnation: envelope.incarnation,
      invocationId: witness.invocationId,
      revision: witness.revision,
      lockToken: token,
    }
    try {
      await handler.run(
        payload,
        this.context(definition, job, envelope.incarnation, witness.invocationId)
      )
      await reportManagedInvocation(client, key, {
        ...identity,
        report: 'success',
        code: 'COMPLETED',
      }).catch(() => undefined)
      return
    } catch (error) {
      const permanent = isPermanentWorkFailure(error)
      await reportManagedInvocation(client, key, {
        ...identity,
        report: 'failure',
        code: permanent ? 'PERMANENT_FAILURE' : 'TRANSIENT_FAILURE',
        failureCode: workFailureCode(definition, error),
      }).catch(() => undefined)
      if (permanent) throw new UnrecoverableError('PERMANENT_FAILURE')
      throw new Error('TRANSIENT_FAILURE')
    }
  }

  private context(
    definition: WorkDefinition,
    job: Job,
    incarnation: string,
    invocationId: string
  ): WorkInvocation {
    return {
      workId: definition.id,
      jobId: job.id!,
      incarnation,
      invocationId,
      signal: this.readiness.signal,
    }
  }
}
