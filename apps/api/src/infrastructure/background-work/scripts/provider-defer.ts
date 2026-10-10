import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { z } from 'zod'

import { jobPredicateKeys } from '../job-snapshot'

import { PROVIDER_DEFER_LUA } from './provider-defer.lua'

const schema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  lockToken: z.string().min(1).max(128),
  incarnation: z.uuidv7(),
  revision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  floorUpper: z.number().int().nonnegative(),
  nominalDeadline: z.number().int().positive(),
  commandId: z.uuidv7().optional(),
})

export async function deferProviderCooldown(
  client: Redis,
  queue: Queue,
  request: z.input<typeof schema>
): Promise<'deferred' | 'eligible' | { readonly reason: string }> {
  const input = schema.parse(request)
  const keys = [...jobPredicateKeys(queue, input.id), queue.toKey('stalled')]
  const result = await client.eval(
    PROVIDER_DEFER_LUA,
    keys.length,
    ...keys,
    input.id,
    input.lockToken,
    input.incarnation,
    input.revision,
    input.floorUpper,
    input.nominalDeadline,
    input.commandId ?? ''
  )
  if (!Array.isArray(result)) throw new Error('INVALID_BROKER_REPLY')
  if (result[0] === 'deferred') return 'deferred'
  if (result[0] === 'eligible') return 'eligible'
  if (['unavailable', 'rejected'].includes(result[0] as string) && typeof result[1] === 'string')
    return { reason: result[1] }
  throw new Error('INVALID_BROKER_REPLY')
}
