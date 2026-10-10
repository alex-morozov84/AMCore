import type { Redis } from 'ioredis'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

import { IDEMPOTENT_START_LUA } from './idempotent-start.lua'

const requestSchema = z.strictObject({
  incarnation: z.uuid(),
  policyVersion: z.number().int().positive(),
  wireVersion: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  dataFingerprint: z.string().regex(/^[a-f0-9]{40}$/),
  optionsFingerprint: z.string().regex(/^[a-f0-9]{40}$/),
  lockToken: z.string().min(1).max(128),
  manualCommandId: z.uuid().optional(),
  manualDispatchId: z.uuid().optional(),
})
export type StartRequest = z.input<typeof requestSchema>
export type StartWitness =
  | { readonly status: 'rejected'; readonly reason: string }
  | {
      readonly status: 'started'
      readonly revision: number
      readonly startedAt: number
      readonly invocationId: string
      readonly mode: 'automatic' | 'manual'
    }

export async function startIdempotentInvocation(
  client: Redis,
  jobKey: string,
  request: StartRequest
): Promise<StartWitness> {
  const input = requestSchema.parse(request)
  const invocationId = uuidv7()
  const result = await client.eval(
    IDEMPOTENT_START_LUA,
    2,
    jobKey,
    `${jobKey}:lock`,
    input.incarnation,
    input.policyVersion,
    input.wireVersion,
    input.revision,
    input.lockToken,
    invocationId,
    input.manualCommandId ?? '',
    input.manualDispatchId ?? '',
    input.dataFingerprint,
    input.optionsFingerprint
  )
  if (!Array.isArray(result)) throw new Error('INVALID_BROKER_REPLY')
  if (result[0] === 'rejected' && typeof result[1] === 'string')
    return { status: 'rejected', reason: result[1] }
  if (result[0] !== 'started' || (result[3] !== 'manual' && result[3] !== 'automatic'))
    throw new Error('INVALID_BROKER_REPLY')
  return {
    status: 'started',
    revision: Number(result[1]),
    startedAt: Number(result[2]),
    invocationId,
    mode: result[3],
  }
}
