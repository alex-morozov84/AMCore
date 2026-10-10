import { createHash } from 'node:crypto'

import type { Redis } from 'ioredis'
import { z } from 'zod'

import { QUEUE_READ_LUA } from './scripts/queue-read.lua'

const countsSchema = z.tuple(
  Array.from({ length: 5 }, () => z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)) as [
    z.ZodNumber,
    z.ZodNumber,
    z.ZodNumber,
    z.ZodNumber,
    z.ZodNumber,
  ]
)
const snapshotSchema = z.strictObject({
  epoch: z.uuidv7(),
  controlRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  paused: z.boolean(),
  layout: z.enum(['modern', 'legacy-paused-only', 'legacy-mixed']),
  sampledAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  counts: countsSchema,
})
export type QueueSnapshot = z.infer<typeof snapshotSchema> & { readonly revision: string }

/** Counts are excluded from queue CAS: concurrent enqueue/claims do not invalidate pause/resume. */
export function queueRevision(epoch: string, controlRevision: number, paused: boolean): string {
  return createHash('sha256')
    .update(JSON.stringify({ epoch, controlRevision, paused }))
    .digest('hex')
}

export async function readQueueSnapshot(
  client: Redis,
  prefix: string
): Promise<
  | { readonly status: 'observed'; readonly snapshot: QueueSnapshot }
  | { readonly status: 'unavailable'; readonly reason: string }
> {
  const keys = [
    'meta',
    'wait',
    'paused',
    'active',
    'prioritized',
    'delayed',
    'marker',
    'events',
  ].map((name) => `${prefix}${name}`)
  const result = await client.eval(QUEUE_READ_LUA, keys.length, ...keys)
  if (!Array.isArray(result)) throw new Error('INVALID_BROKER_REPLY')
  if (result[0] === 'unavailable' && typeof result[1] === 'string')
    return { status: 'unavailable', reason: result[1] }
  if (
    result[0] !== 'observed' ||
    result.length !== 11 ||
    !Array.isArray(result[5]) ||
    result[5].length !== 2 ||
    !['0', '1'].includes(result[3] as string)
  )
    throw new Error('INVALID_BROKER_REPLY')
  const snapshot = snapshotSchema.parse({
    epoch: result[1],
    controlRevision: Number(result[2]),
    paused: result[3] === '1',
    layout: result[4],
    sampledAt: Number(result[5][0]) * 1000 + Math.floor(Number(result[5][1]) / 1000),
    counts: result.slice(6),
  })
  return {
    status: 'observed',
    snapshot: {
      ...snapshot,
      revision: queueRevision(snapshot.epoch, snapshot.controlRevision, snapshot.paused),
    },
  }
}
