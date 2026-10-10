import { createHash } from 'node:crypto'

import type { Job, Queue } from 'bullmq'
import { UnrecoverableError } from 'bullmq'
import type { Redis } from 'ioredis'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'

import { readBoundedJob } from '../background-work/bounded-job-reader'
import { managedJobKey } from '../background-work/managed-job-key'
import { parseManagedJob } from '../background-work/managed-job-profile'
import type { ManagedEnvelope } from '../background-work/managed-producer'
import { readQueueSnapshot } from '../background-work/queue-snapshot'
import { JOB_READ_GUARD_LUA } from '../background-work/scripts/job-read.lua'
import type { WorkDefinition } from '../background-work/work-definition'

import { sendEmailJobDataSchema } from './email.schema'

const ADOPT_LEGACY_LUA =
  JOB_READ_GUARD_LUA +
  `
local function reject(code) return {'rejected',code} end
if redis.call('TYPE',KEYS[2]).ok ~= 'string' or redis.call('STRLEN',KEYS[2]) > 128 or
  redis.call('GET',KEYS[2]) ~= ARGV[1] or redis.call('PTTL',KEYS[2]) < 2000 then return reject('STATE_CHANGED') end
local values = redis.call('HMGET',KEYS[1],unpack(fields))
if redis.call('TYPE',KEYS[3]).ok ~= 'hash' or redis.call('HLEN',KEYS[3]) > 64 or
  redis.call('HSTRLEN',KEYS[3],'amQueueEpoch') > 128 then return reject('CONTENT_UNSUPPORTED') end
if redis.call('HGET',KEYS[3],'amQueueEpoch') ~= ARGV[7] then return reject('STATE_CHANGED') end
if redis.sha1hex(values[2] or '') ~= ARGV[2] or redis.sha1hex(values[3] or '') ~= ARGV[3] then
  return reject('STATE_CHANGED') end
local ats,atm = tonumber(values[7]),tonumber(values[8] or '0')
if not ats or not atm or ats < 1 or atm < 0 or ats > 2147483647 or atm > 2147483647 or
  ats ~= math.floor(ats) or atm ~= math.floor(atm) then return reject('CONTENT_UNSUPPORTED') end
if ats ~= tonumber(ARGV[8]) or atm ~= tonumber(ARGV[9]) or
  redis.sha1hex(values[33] or '') ~= ARGV[10] then return reject('STATE_CHANGED') end
if values[4] or values[5] or values[6] or values[15] or values[16] or values[17] or values[18] or
  values[19] or values[20] or values[21] or values[22] or values[23] or values[24] or values[25] or
  values[26] or values[30] or values[31] or values[32] or values[34] then return reject('OUTCOME_UNRECORDED') end
local unknown = ats ~= 1 or atm ~= 0 or (values[33] and #values[33] > 0)
local extra = unknown and 3 or 1
if redis.call('HLEN',KEYS[1]) + extra > 64 or #ARGV[4] > 32768 or #ARGV[5] > 16384 then
  return reject('CONTENT_UNSUPPORTED') end
-- Every type, size, identity, lock and legacy counter predicate precedes the first write.
redis.call('HSET',KEYS[1],'data',ARGV[4],'opts',ARGV[5],'amIncarnation',ARGV[6])
if unknown then redis.call('HSET',KEYS[1],'amLegacyRequestUnknown','1','amEvidenceInitialized','1') end
return {unknown and 'unknown' or 'adopted',ats}
`

export interface LegacyEmailAdoption {
  readonly unknown: boolean
  readonly starts: number
  readonly queueEpoch: string
  readonly envelope: ManagedEnvelope
  readonly options: Job['opts']
  readonly key: string
  readonly arguments: readonly (string | number)[]
}

/** Read/validate only. The caller releases this lease before reserving independent legacy PG evidence. */
export async function prepareLegacyQueuedEmail(
  client: Redis,
  definition: WorkDefinition,
  queue: Queue,
  job: Job,
  token: string
): Promise<LegacyEmailAdoption> {
  if (definition.id !== 'email') throw new UnrecoverableError('VERSION_UNSUPPORTED')
  const key = managedJobKey(queue, job.id!)
  const observed = await readBoundedJob(client, key)
  if (observed.status !== 'observed') throw new UnrecoverableError(observed.reason)
  if (observed.fields.name !== job.name) throw new UnrecoverableError('STATE_CHANGED')
  let raw: unknown
  try {
    raw = JSON.parse(observed.fields.data ?? 'null') as unknown
  } catch {
    throw new UnrecoverableError('PERMANENT_FAILURE')
  }
  if (raw && typeof raw === 'object' && 'protocolVersion' in raw)
    throw new UnrecoverableError('STATE_CHANGED')
  const payload = sendEmailJobDataSchema.safeParse(raw)
  if (!payload.success) throw new UnrecoverableError('PERMANENT_FAILURE')
  const binding = definition.jobs[job.name]!
  const envelope = {
    protocolVersion: 1 as const,
    incarnation: uuidv7(),
    jobVersion: binding.wireVersion,
    executionPolicyVersion: binding.replay.policyVersion,
    createdAt: Date.now(),
    payload: payload.data,
  }
  let options: Record<string, unknown> | null
  try {
    options = JSON.parse(observed.fields.opts ?? 'null') as Record<string, unknown> | null
  } catch {
    throw new UnrecoverableError('CONTENT_UNSUPPORTED')
  }
  if (
    !options ||
    !z
      .strictObject({ type: z.literal('exponential'), delay: z.literal(1000) })
      .safeParse(options.backoff).success
  )
    throw new UnrecoverableError('CONTENT_UNSUPPORTED')
  const upgraded = { ...options, backoff: { type: 'exponential', delay: 2000 } }
  const data = JSON.stringify(envelope),
    opts = JSON.stringify(upgraded)
  parseManagedJob(definition, { ...observed.fields, data, opts })
  const state = await readQueueSnapshot(client, queue.toKey(''))
  if (state.status !== 'observed') throw new UnrecoverableError(state.reason)
  const starts = z.coerce.number().int().min(1).max(2147483647).parse(observed.fields.ats)
  const made = z.coerce
    .number()
    .int()
    .min(0)
    .max(2147483647)
    .parse(observed.fields.atm ?? '0')
  return {
    unknown: starts !== 1 || made !== 0 || !!observed.fields.failedReason,
    starts,
    queueEpoch: state.snapshot.epoch,
    envelope,
    options: upgraded as Job['opts'],
    key,
    arguments: [
      token,
      createHash('sha1').update(observed.fields.data!).digest('hex'),
      createHash('sha1').update(observed.fields.opts!).digest('hex'),
      data,
      opts,
      envelope.incarnation,
      state.snapshot.epoch,
      starts,
      made,
      createHash('sha1')
        .update(observed.fields.failedReason ?? '')
        .digest('hex'),
    ],
  }
}

/** One fenced EVAL. An ambiguous reply is never retried; the independent evidence already protects unknown work. */
export async function applyLegacyQueuedEmail(
  client: Redis,
  queue: Queue,
  job: Job,
  proposal: LegacyEmailAdoption
): Promise<void> {
  const reply = await client.eval(
    ADOPT_LEGACY_LUA,
    3,
    proposal.key,
    `${proposal.key}:lock`,
    queue.toKey('meta'),
    ...proposal.arguments
  )
  if (!Array.isArray(reply) || !['adopted', 'unknown'].includes(String(reply[0])))
    throw new UnrecoverableError(Array.isArray(reply) ? String(reply[1]) : 'OUTCOME_UNRECORDED')
  if ((reply[0] === 'unknown') !== proposal.unknown || Number(reply[1]) !== proposal.starts)
    throw new UnrecoverableError('OUTCOME_UNRECORDED')
  job.data = proposal.envelope
  job.opts = proposal.options
}
