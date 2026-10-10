import { createHash } from 'node:crypto'

import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { z } from 'zod'

import { type WorkReason, workReasonSchema } from '@amcore/shared'

import { managedJobKey } from './managed-job-key'
import { PREPARED_BODY_LUA } from './scripts/prepared-body.lua'

const identitySchema = z.strictObject({
  incarnation: z.uuidv7(),
  lockToken: z.string().min(1).max(128),
  providerScope: z.string().regex(/^[a-f0-9]{64}$/),
})
export type PreparedBodyIdentity = z.infer<typeof identitySchema>
export type PreparedBody =
  | { readonly status: 'missing' }
  | { readonly status: 'unavailable'; readonly reason: WorkReason }
  | {
      readonly status: 'prepared'
      readonly body: string
      readonly digest: string
      readonly providerScope: string
      readonly expiresAt: number
    }

/** Private port only. No generic observation/controller exposes bodies, addresses or credential hashes. */
export async function preparedBody(
  client: Redis,
  queue: Queue,
  jobId: string,
  request: PreparedBodyIdentity,
  body?: string
): Promise<PreparedBody> {
  const input = identitySchema.parse(request)
  if (
    body !== undefined &&
    (Buffer.byteLength(body, 'utf8') < 1 || Buffer.byteLength(body, 'utf8') > 131072)
  )
    return { status: 'unavailable', reason: 'CONTENT_UNSUPPORTED' }
  const job = managedJobKey(queue, jobId)
  const base = queue.toKey('am:prepared:')
  const result = await client.eval(
    PREPARED_BODY_LUA,
    6,
    job,
    `${job}:lock`,
    `${base}account`,
    `${base}expiry`,
    `${base}sizes`,
    `${job}:am-request:${input.incarnation}`,
    input.incarnation,
    input.lockToken,
    body === undefined ? 'read' : 'prepare',
    input.providerScope,
    body ?? '',
    body === undefined ? '' : createHash('sha256').update(body).digest('hex'),
    queue.toKey(''),
    jobId
  )
  if (!Array.isArray(result)) throw new Error('INVALID_BROKER_REPLY')
  if (result[0] === 'missing' && result.length === 1) return { status: 'missing' }
  if (result[0] === 'unavailable' && result.length === 2)
    return { status: 'unavailable', reason: workReasonSchema.parse(result[1]) }
  if (
    result[0] !== 'prepared' ||
    result.length !== 5 ||
    typeof result[1] !== 'string' ||
    Buffer.byteLength(result[1], 'utf8') > 131072 ||
    createHash('sha256').update(result[1]).digest('hex') !== result[2] ||
    result[3] !== input.providerScope
  )
    throw new Error('INVALID_BROKER_REPLY')
  const expiresAt = z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .parse(Number(result[4]))
  return {
    status: 'prepared',
    body: result[1],
    digest: result[2] as string,
    providerScope: result[3],
    expiresAt,
  }
}
