import type { Queue } from 'bullmq'
import type { Redis } from 'ioredis'

import type { PrismaClient } from '../../generated/prisma/client.js'
import { readJobSnapshot } from '../background-work/job-snapshot.js'
import { managedJobKey } from '../background-work/managed-job-key.js'
import { parseManagedJob } from '../background-work/managed-job-profile.js'

import { emailWork } from './email.work.js'

const CLEAN_FIELDS = [
  'amMetadata',
  'amHistory',
  'amRevision',
  'amAutoStartsUsed',
  'amManualGrant',
  'amMode',
  'amIncarnation',
  'amManualCommandId',
  'amManualDispatchId',
  'amRequestPrepared',
  'amRequestDigest',
  'amProviderScope',
  'amRequestExpiresAt',
  'amEffectAttempt',
  'amEffectRevision',
  'amEvidenceInitialized',
  'amLegacyRequestUnknown',
  'amInvocationId',
  'processedOn',
  'finishedOn',
  'parentKey',
  'parent',
  'deid',
  'repeatJobKey',
  'rjk',
  'failedReason',
]

/** Maintenance only: PG absence is stable only after every mutator has stopped. */
export async function upgradeWelcomeJob(
  client: Redis,
  db: Pick<PrismaClient, 'backgroundEffectEvidence'>,
  queue: Queue,
  id: string,
  apply: boolean
): Promise<{
  status: string
  reason?: string
  incarnation?: string
  fromPolicy?: number
  toPolicy?: number
}> {
  const observed = await readJobSnapshot(client, queue, id)
  if (observed.status !== 'observed') return { status: 'blocked', reason: observed.reason }
  const snapshot = observed.snapshot
  if (!snapshot.paused || snapshot.locked || snapshot.state === 'active')
    return { status: 'blocked', reason: 'ACTIVE_JOB' }
  const fields = snapshot.raw.fields
  let profile: ReturnType<typeof parseManagedJob>
  try {
    const old = {
      ...emailWork,
      jobs: {
        'send-email': {
          ...emailWork.jobs['send-email'],
          replay: {
            kind: 'provider-window' as const,
            policyVersion: 1,
            recipe: 'queued-email' as const,
          },
        },
      },
    }
    profile = parseManagedJob(old, fields)
  } catch {
    try {
      const current = parseManagedJob(emailWork, fields)
      const retained = await db.backgroundEffectEvidence.findUnique({
        where: {
          workId_incarnation: { workId: 'email', incarnation: current.envelope.incarnation },
        },
      })
      if (retained && (retained.policyVersion !== 2 || retained.recipeVersion !== 2))
        return { status: 'protected', reason: 'VERSION_UNSUPPORTED' }
      return { status: 'already_v2' }
    } catch {
      return { status: 'blocked', reason: 'VERSION_UNSUPPORTED' }
    }
  }
  const row = await db.backgroundEffectEvidence.findUnique({
    where: { workId_incarnation: { workId: 'email', incarnation: profile.envelope.incarnation } },
  })
  if (row)
    return {
      status: 'protected',
      reason:
        row.certainty === 'accepted'
          ? 'EFFECT_ACCEPTED'
          : row.certainty === 'unknown' || !row.outcomeRecorded
            ? 'EFFECT_UNKNOWN'
            : 'VERSION_UNSUPPORTED',
    }
  if (
    Number(fields.ats ?? 0) !== 0 ||
    Number(fields.atm ?? 0) !== 0 ||
    CLEAN_FIELDS.some((name) => fields[name] !== null) ||
    snapshot.relations.some((count) => count !== 0) ||
    !['waiting', 'delayed', 'prioritized'].includes(snapshot.state)
  )
    return { status: 'blocked', reason: 'OUTCOME_UNRECORDED' }
  const next = JSON.stringify({ ...profile.envelope, executionPolicyVersion: 2 })
  const options = JSON.stringify({
    ...JSON.parse(fields.opts!),
    backoff: { type: 'exponential', delay: 1000 },
  })
  if (!apply) return { status: 'eligible' }
  const job = managedJobKey(queue, id)
  const result = await client.eval(
    `
    if redis.call('HGET',KEYS[2],'paused') ~= '1' or redis.call('LLEN',KEYS[3]) ~= 0 or
      redis.call('EXISTS',KEYS[4]) ~= 0 then return 0 end
    if redis.call('HGET',KEYS[1],'data') ~= ARGV[1] or
      redis.call('HGET',KEYS[1],'opts') ~= ARGV[2] then return 0 end
    local allowed = {name=true,data=true,opts=true,timestamp=true,delay=true,priority=true,
      progress=true,ats=true,atm=true}
    for _,name in ipairs(redis.call('HKEYS',KEYS[1])) do
      if not allowed[name] then return 0 end
    end
    for _,name in ipairs(cjson.decode(ARGV[5])) do
      if redis.call('HEXISTS',KEYS[1],name) ~= 0 then return 0 end
    end
    if tonumber(redis.call('HGET',KEYS[1],'ats') or '0') ~= 0 or
      tonumber(redis.call('HGET',KEYS[1],'atm') or '0') ~= 0 or
      redis.call('EXISTS',KEYS[5]) ~= 0 or redis.call('HEXISTS',KEYS[6],ARGV[6]) ~= 0 or
      redis.call('ZSCORE',KEYS[7],ARGV[6]) or redis.call('HEXISTS',KEYS[8],ARGV[6]) ~= 0 then return 0 end
    redis.call('HSET',KEYS[1],'data',ARGV[3],'opts',ARGV[4])
    return 1`,
    8,
    job,
    queue.toKey('meta'),
    queue.toKey('active'),
    `${job}:lock`,
    `${job}:am-request:${profile.envelope.incarnation}`,
    queue.toKey('am:prepared:sizes'),
    queue.toKey('am:prepared:expiry'),
    queue.toKey('am:prepared:account'),
    fields.data!,
    fields.opts!,
    next,
    options,
    JSON.stringify(CLEAN_FIELDS),
    profile.envelope.incarnation
  )
  return {
    status: result === 1 ? 'converted' : 'blocked',
    incarnation: profile.envelope.incarnation,
    fromPolicy: 1,
    toPolicy: 2,
    ...(result === 1 ? {} : { reason: 'STATE_CHANGED' }),
  }
}
