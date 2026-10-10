import { createHash } from 'node:crypto'

import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { z } from 'zod'

import { decodeBoundedJob, type RawJobObservation } from './bounded-job-reader'
import { managedJobKey } from './managed-job-key'
import { JOB_MEMBERSHIP_READ_LUA } from './scripts/job-membership.lua'

const numeric = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const metadataSchema = z.strictObject({
  epoch: z.uuidv7(),
  controlRevision: numeric,
  paused: z.boolean(),
  state: z.enum([
    'waiting',
    'active',
    'failed',
    'completed',
    'delayed',
    'prioritized',
    'waiting-children',
  ]),
  score: z.string().max(128).nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{40}$/),
  locked: z.boolean(),
  relations: z.array(numeric).length(4),
  sampledAt: numeric,
})
export type JobSnapshot = z.infer<typeof metadataSchema> & {
  readonly revision: string
  readonly raw: Extract<RawJobObservation, { status: 'observed' }>
}

/** Provider authority can change without a broker report; both revisions belong to the captured identity. */
export function providerTargetRevision(
  brokerRevision: string,
  evidenceRevision: number | null
): string {
  return createHash('sha256')
    .update(`${brokerRevision}:${evidenceRevision ?? 'missing'}`)
    .digest('hex')
}

/** Fixed key shape used for both read and before-write proofs. No arbitrary key input from HTTP. */
export function jobPredicateKeys(queue: Queue, id: string): readonly string[] {
  const job = managedJobKey(queue, id)
  return [
    job,
    ...[
      'meta',
      'wait',
      'paused',
      'active',
      'failed',
      'completed',
      'delayed',
      'prioritized',
      'waiting-children',
    ].map((suffix) => queue.toKey(suffix)),
    ...['lock', 'dependencies', 'processed', 'failed', 'unsuccessful', 'logs'].map(
      (suffix) => `${job}:${suffix}`
    ),
    queue.toKey('events'),
    queue.toKey('marker'),
    queue.toKey('repeat'),
  ]
}

export async function readJobSnapshot(
  client: Redis,
  queue: Queue,
  id: string
): Promise<
  | { readonly status: 'observed'; readonly snapshot: JobSnapshot }
  | { readonly status: 'unavailable'; readonly reason: string }
> {
  const keys = jobPredicateKeys(queue, id)
  const result = await client.eval(JOB_MEMBERSHIP_READ_LUA, keys.length, ...keys, id)
  if (!Array.isArray(result)) throw new Error('INVALID_BROKER_REPLY')
  if (result[0] === 'unavailable' && typeof result[1] === 'string')
    return { status: 'unavailable', reason: result[1] }
  if (
    result[0] !== 'observed' ||
    result.length !== 10 ||
    !Array.isArray(result[6]) ||
    result[6].length !== 6 ||
    !Array.isArray(result[9]) ||
    result[9].length !== 2 ||
    !['0', '1'].includes(result[7] as string)
  )
    throw new Error('INVALID_BROKER_REPLY')
  const raw = decodeBoundedJob(result.slice(0, 3))
  if (raw.status !== 'observed') throw new Error('INVALID_BROKER_REPLY')
  const metadata = metadataSchema.parse({
    epoch: result[6][0],
    controlRevision: Number(result[6][1]),
    paused: result[6][3] === '1',
    state: result[3],
    score: result[4],
    fingerprint: result[5],
    locked: result[7] === '1',
    relations: result[8],
    sampledAt: Number(result[9][0]) * 1000 + Math.floor(Number(result[9][1]) / 1000),
  })
  const revision = createHash('sha256').update(metadata.fingerprint).digest('hex')
  return { status: 'observed', snapshot: { ...metadata, revision, raw } }
}
