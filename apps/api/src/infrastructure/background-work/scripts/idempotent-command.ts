import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { z } from 'zod'

import { workJobIdSchema, type WorkReason, workReasonSchema } from '@amcore/shared'

import { jobPredicateKeys } from '../job-snapshot'
import { managedJobKey } from '../managed-job-key'

import { IDEMPOTENT_COMMAND_LUA, PROVIDER_COMMAND_LUA } from './idempotent-command.lua'

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const requestSchema = z
  .strictObject({
    id: workJobIdSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{40}$/),
    operation: z.enum(['retry', 'cancel', 'cleanup']),
    incarnation: z.uuidv7(),
    wireVersion: integer.min(1),
    policyVersion: integer.min(1),
    admittedAt: integer,
    dispatchNotAfter: integer,
    commandId: z.uuidv7(),
    dispatchId: z.uuidv7(),
    cleanup: z
      .strictObject({
        cutoff: integer,
        minimumAgeMs: integer.min(1).max(30 * 86400000),
        state: z.enum(['completed', 'failed']),
      })
      .optional(),
  })
  .superRefine((request, ctx) => {
    if ((request.operation === 'cleanup') !== !!request.cleanup)
      ctx.addIssue({ code: 'custom', path: ['cleanup'] })
  })
export type IdempotentCommandRequest = z.infer<typeof requestSchema>
const evidenceSchema = z.strictObject({
  revision: integer.min(1),
  digest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  scope: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  nominalDeadline: integer.nullable(),
  floorUpper: integer,
})
export type ProviderCommandEvidence = z.infer<typeof evidenceSchema>

/** Only the idempotent policy calls this transition; provider-window owns a stronger admission port. */
export async function applyIdempotentCommand(
  client: Redis,
  queue: Queue,
  request: IdempotentCommandRequest,
  checkOnly = false
): Promise<
  { readonly status: 'applied' } | { readonly status: 'rejected'; readonly reason: WorkReason }
> {
  return apply(client, queue, request, checkOnly)
}

export async function applyProviderWindowCommand(
  client: Redis,
  queue: Queue,
  request: IdempotentCommandRequest,
  evidence: ProviderCommandEvidence,
  checkOnly = false
): Promise<
  { readonly status: 'applied' } | { readonly status: 'rejected'; readonly reason: WorkReason }
> {
  return apply(client, queue, request, checkOnly, evidenceSchema.parse(evidence))
}

async function apply(
  client: Redis,
  queue: Queue,
  request: IdempotentCommandRequest,
  checkOnly: boolean,
  evidence?: ProviderCommandEvidence
): Promise<
  { readonly status: 'applied' } | { readonly status: 'rejected'; readonly reason: WorkReason }
> {
  const input = requestSchema.parse(request)
  const keys = [...jobPredicateKeys(queue, input.id)]
  if (evidence) {
    const base = queue.toKey('am:prepared:')
    keys.push(
      `${managedJobKey(queue, input.id)}:am-request:${input.incarnation}`,
      `${base}account`,
      `${base}expiry`,
      `${base}sizes`
    )
  }
  const result = await client.eval(
    evidence ? PROVIDER_COMMAND_LUA : IDEMPOTENT_COMMAND_LUA,
    keys.length,
    ...keys,
    input.id,
    input.fingerprint,
    input.operation,
    input.incarnation,
    input.wireVersion,
    input.policyVersion,
    input.admittedAt,
    input.dispatchNotAfter,
    input.commandId,
    input.dispatchId,
    input.cleanup?.cutoff ?? '',
    input.cleanup?.minimumAgeMs ?? '',
    input.cleanup?.state ?? '',
    checkOnly ? 'check' : '',
    evidence?.revision ?? '',
    evidence?.digest ?? '',
    evidence?.scope ?? '',
    evidence?.nominalDeadline ?? '',
    evidence?.floorUpper ?? ''
  )
  if (!Array.isArray(result)) throw new Error('INVALID_BROKER_REPLY')
  if (result[0] === 'applied' && result.length === 1) return { status: 'applied' }
  if (result[0] === 'unavailable' && result.length === 2)
    return { status: 'rejected', reason: workReasonSchema.parse(result[1]) }
  throw new Error('INVALID_BROKER_REPLY')
}
