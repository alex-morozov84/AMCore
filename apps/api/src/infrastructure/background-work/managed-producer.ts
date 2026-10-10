import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { z } from 'zod'

import { createUuidV7 as uuidv7 } from '@amcore/shared'

import { DEFAULT_JOB_OPTIONS } from '../queue/interfaces/job-options.interface'

import { managedJobKey } from './managed-job-key'
import { initializeManagedQueue } from './scripts/initialize-queue'
import type { WorkDefinition } from './work-definition'
import { canonicalWire, parseWorkPayload } from './work-payload'
import { WorkReadiness } from './work-readiness'

const optionsSchema = z.strictObject({
  jobId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  delay: z
    .number()
    .int()
    .min(0)
    .max(30 * 86400000)
    .optional(),
  priority: z.number().int().min(0).max(2097152).optional(),
  attempts: z.number().int().min(1).max(10).optional(),
})

export type ManagedJobOptions = z.input<typeof optionsSchema>
export interface ManagedJobIdentity {
  readonly jobId: string
  readonly incarnation: string
}

export interface ManagedEnvelope {
  readonly protocolVersion: 1
  readonly incarnation: string
  readonly jobVersion: number
  readonly executionPolicyVersion: number
  readonly createdAt: number
  readonly payload: unknown
}

/** Closed producer surface: clients cannot replace retention, schemas or system metadata. */
export class ManagedProducer<D extends WorkDefinition> {
  constructor(
    private readonly definition: D,
    private readonly queue: Queue,
    private readonly readiness: WorkReadiness
  ) {}

  async add<K extends keyof D['jobs'] & string>(
    jobName: K,
    payload: z.input<D['jobs'][K]['schema']>,
    options: ManagedJobOptions = {}
  ): Promise<ManagedJobIdentity> {
    this.readiness.assertReady()
    const binding = this.definition.jobs[jobName]
    if (!binding || !this.definition.queue?.enabled) throw new Error('WORK_UNAVAILABLE')
    const parsedOptions = optionsSchema.parse(options)
    if (parsedOptions.jobId) managedJobKey(this.queue, parsedOptions.jobId)
    const envelope: ManagedEnvelope = {
      protocolVersion: 1,
      incarnation: uuidv7(),
      jobVersion: binding.wireVersion,
      executionPolicyVersion: binding.replay.policyVersion,
      createdAt: Date.now(),
      payload: canonicalWire(binding, payload),
    }
    if (Buffer.byteLength(JSON.stringify(envelope), 'utf8') > 32768)
      throw new Error('CONTENT_UNSUPPORTED')
    parseWorkPayload(binding, envelope.payload)
    const client = (await this.queue.getBackend().client) as unknown as Redis
    await initializeManagedQueue(client, this.queue.toKey('meta'))
    const job = await this.queue.add(jobName, envelope, {
      ...DEFAULT_JOB_OPTIONS,
      ...parsedOptions,
      ...(binding.replay.kind === 'provider-window'
        ? { backoff: { type: 'exponential' as const, delay: 2000 } }
        : {}),
      ...(this.definition.kind === 'wake' ? { attempts: 1 } : {}),
      jobId: parsedOptions.jobId ?? envelope.incarnation,
      removeOnComplete: { age: binding.retention.completedMs / 1000, count: 100 },
      removeOnFail: { age: binding.retention.failedMs / 1000, count: 1000 },
    })
    // Duplicate add returns the existing immutable incarnation, never the new proposal.
    const raw = await client.eval(
      `
      local kind = redis.call('TYPE', KEYS[1]).ok
      if kind ~= 'hash' or redis.call('HLEN', KEYS[1]) > 64 then return false end
      if redis.call('HSTRLEN', KEYS[1], 'data') > 32768 then return false end
      return redis.call('HGET', KEYS[1], 'data')
    `,
      1,
      managedJobKey(this.queue, job.id!)
    )
    const identity = typeof raw === 'string' ? (JSON.parse(raw) as ManagedEnvelope) : undefined
    if (
      !identity ||
      identity.protocolVersion !== 1 ||
      !z.uuid().safeParse(identity.incarnation).success
    )
      throw new Error('METADATA_UNAVAILABLE')
    return { jobId: job.id!, incarnation: identity.incarnation }
  }
}
