import type { Redis } from 'ioredis'
import { z } from 'zod'

import type { ProviderAttempt } from '../provider-evidence.store'

import { PROVIDER_FENCE_LUA } from './provider-fence.lua'

const fenceSchema = z.strictObject({
  incarnation: z.uuidv7(),
  queueEpoch: z.uuidv7(),
  attemptId: z.uuidv7(),
  wireVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  revision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  effectRevision: z.number().int().positive().max(2147483646),
  lockToken: z.string().min(1).max(128),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  providerScope: z.string().regex(/^[a-f0-9]{64}$/),
  pgTime: z.number().int().nonnegative(),
  nominalDeadline: z.number().int().positive(),
  floorUpper: z.number().int().nonnegative(),
  autoStartsUsed: z.number().int().min(0).max(10),
  manualGrant: z.enum(['none', 'spent']),
  mode: z.enum(['automatic', 'manual']),
  refence: z.boolean(),
  automaticLimit: z.number().int().min(1).max(10),
  commandFence: z.uuidv7().nullable(),
})

export type ProviderFenceResult =
  | { readonly status: 'fenced'; readonly revision: number; readonly redisTime: number }
  | { readonly status: 'rejected'; readonly reason: string }

/** One EVAL, never retry an ambiguous reply: it may already have admitted this attempt. */
export async function fenceProviderAttempt(
  client: Redis,
  jobKey: string,
  metaKey: string,
  lockToken: string,
  revision: number,
  attempt: ProviderAttempt,
  refence = false
): Promise<ProviderFenceResult> {
  const row = attempt.row
  const input = fenceSchema.parse({
    incarnation: row.incarnation,
    queueEpoch: row.queueEpoch,
    attemptId: attempt.attemptId,
    wireVersion: row.wireVersion,
    policyVersion: row.policyVersion,
    revision,
    effectRevision: row.revision,
    lockToken,
    requestDigest: row.requestDigest,
    providerScope: row.providerScope,
    pgTime: attempt.pgTime,
    nominalDeadline: row.nominalDeadline?.getTime(),
    floorUpper: Number(row.floorUpper),
    autoStartsUsed: row.autoStartsUsed,
    manualGrant: row.manualGrant,
    mode: attempt.mode,
    refence,
    automaticLimit: row.automaticLimit,
    commandFence: row.commandFence,
  })
  const reply = await client.eval(
    PROVIDER_FENCE_LUA,
    4,
    jobKey,
    `${jobKey}:lock`,
    `${jobKey}:am-request:${input.incarnation}`,
    metaKey,
    input.incarnation,
    input.wireVersion,
    input.policyVersion,
    input.revision,
    input.lockToken,
    input.queueEpoch,
    input.requestDigest,
    input.providerScope,
    input.pgTime,
    input.nominalDeadline,
    input.floorUpper,
    input.attemptId,
    input.effectRevision,
    input.autoStartsUsed,
    input.manualGrant,
    input.mode,
    input.refence ? '1' : '0',
    input.automaticLimit,
    input.commandFence ?? ''
  )
  if (!Array.isArray(reply)) throw new Error('INVALID_BROKER_REPLY')
  if (reply[0] === 'rejected' || reply[0] === 'unavailable') {
    if (typeof reply[1] === 'string') return { status: 'rejected', reason: reply[1] }
  }
  if (reply[0] === 'fenced') {
    const nextRevision = Number(reply[1])
    const redisTime = Number(reply[2])
    if (
      Number.isSafeInteger(nextRevision) &&
      nextRevision === revision + 1 &&
      Number.isSafeInteger(redisTime) &&
      redisTime >= 0
    )
      return { status: 'fenced', revision: nextRevision, redisTime }
  }
  throw new Error('INVALID_BROKER_REPLY')
}
