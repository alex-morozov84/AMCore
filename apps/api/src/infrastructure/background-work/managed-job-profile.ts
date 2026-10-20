import { z } from 'zod'

import { workJobIdSchema } from '@amcore/shared'

import { CORRELATION_ID_PATTERN } from '../../common/utils/correlation-id.js'

import { type JobBinding, jobVersions, type WorkDefinition } from './work-definition.js'
import { parseWorkPayload } from './work-payload.js'

/**
 * The one definition of the queued-job wire envelope; producer, executor and the profile reader
 * all parse with it, and `managed-envelope-contract.spec.ts` ties it to the producer type and the
 * Lua readers. Key order matters: the executor compares `JSON.stringify` of the parsed value with
 * the stored data, so the producer must emit keys in this order and omit absent optional keys.
 * Evolution rule: docs/backend/background-work.md ("Changing the job envelope").
 */
export const managedEnvelopeSchema = z.strictObject({
  protocolVersion: z.literal(1),
  incarnation: z.uuidv7(),
  jobVersion: z.number().int().positive(),
  executionPolicyVersion: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  /** Request that caused the job; absent for wake jobs and jobs started outside a request. */
  correlationId: z.string().regex(CORRELATION_ID_PATTERN).optional(),
  payload: z.unknown(),
})
const keepSchema = z.strictObject({
  age: z.number().positive().max(2592000),
  count: z.number().int().positive(),
})
const optionsSchema = z.strictObject({
  jobId: workJobIdSchema.optional(),
  attempts: z.number().int().min(1).max(10).optional(),
  delay: z.number().int().min(0).max(2592000000).optional(),
  priority: z.number().int().min(0).max(2097152).optional(),
  timestamp: z.number().int().nonnegative().optional(),
  lifo: z.boolean().optional(),
  backoff: z.strictObject({ type: z.literal('exponential'), delay: z.number().int().positive() }),
  removeOnComplete: keepSchema,
  removeOnFail: keepSchema,
})

/** Bounded raw observation is validated once against the registration-owned profile. */
export function parseManagedJob(
  definition: WorkDefinition,
  fields: Readonly<Record<string, string | null>>
): {
  envelope: z.infer<typeof managedEnvelopeSchema>
  binding: JobBinding
  payload: unknown
} {
  const envelope = managedEnvelopeSchema.parse(JSON.parse(fields.data ?? 'null'))
  const options = optionsSchema.parse(JSON.parse(fields.opts ?? 'null'))
  const binding = definition.jobs[fields.name ?? '']
  const version =
    binding && jobVersions(binding).find((entry) => entry.wireVersion === envelope.jobVersion)
  if (!binding || !version || envelope.executionPolicyVersion !== binding.replay.policyVersion)
    throw new Error('VERSION_UNSUPPORTED')
  if (
    options.removeOnComplete.age !== binding.retention.completedMs / 1000 ||
    options.removeOnComplete.count !== 100 ||
    options.removeOnFail.age !== binding.retention.failedMs / 1000 ||
    options.removeOnFail.count !== 1000 ||
    options.backoff.delay !== (binding.replay.kind === 'provider-window' ? 2000 : 1000)
  )
    throw new Error('CONTENT_UNSUPPORTED')
  return { envelope, binding, payload: parseWorkPayload(version, envelope.payload) }
}
