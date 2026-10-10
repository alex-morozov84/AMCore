import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import type { JobCounts, JobStatus } from '@bull-board/api/dist/types.js'
import { Job, type Queue } from 'bullmq'
import { z } from 'zod'

import { workJobIdSchema, workListQuerySchema } from '@amcore/shared'

import { readBoundedJobPage } from '../../background-work/bounded-job-reader'
import { decodeBoundedJob } from '../../background-work/bounded-job-reader'
import { ControlConnection } from '../../background-work/control-connection'
import { JOB_READ_GUARD_LUA } from '../../background-work/scripts/job-read.lua'
import { readJobWindow } from '../../background-work/scripts/job-window'

const COUNT_STATES = [
  'wait',
  'paused',
  'active',
  'completed',
  'failed',
  'delayed',
  'prioritized',
  'waiting-children',
] as const
const COUNTS_LUA = `
local result = {}
for i,key in ipairs(KEYS) do
  local list = i <= 3
  local kind = redis.call('TYPE',key).ok
  local expected = i == 9 and 'hash' or (list and 'list' or 'zset')
  if kind ~= 'none' and kind ~= expected then return {'unavailable','CONTENT_UNSUPPORTED'} end
end
if redis.call('HLEN',KEYS[9]) > 16 or redis.call('HSTRLEN',KEYS[9],'paused') > 1 then return {'unavailable','CONTENT_UNSUPPORTED'} end
local paused = redis.call('HGET',KEYS[9],'paused')
if paused and paused ~= '1' then return {'unavailable','CONTENT_UNSUPPORTED'} end
for i = 1,8 do
  local key = KEYS[i]
  result[i] = i <= 3 and redis.call('LLEN',key) or redis.call('ZCARD',key)
end
result[9] = paused and 1 or 0
return result
`
const BOARD_JOB_LUA =
  JOB_READ_GUARD_LUA +
  `
local state = 'unknown'
local states = {'waiting','waiting','active','completed','failed','delayed','prioritized','waiting-children'}
for i = 2,9 do
  local list = i <= 4
  local kind = redis.call('TYPE',KEYS[i]).ok
  if kind ~= 'none' and kind ~= (list and 'list' or 'zset') then return {'unavailable','CONTENT_UNSUPPORTED'} end
  local count = list and redis.call('LLEN',KEYS[i]) or redis.call('ZCARD',KEYS[i])
  if count > 4096 then return {'unavailable','READ_LIMIT'} end
end
for i = 2,9 do
  local present = i <= 4 and redis.call('LPOS',KEYS[i],ARGV[1]) or (i > 4 and redis.call('ZSCORE',KEYS[i],ARGV[1]))
  if present then
    if state ~= 'unknown' then return {'unavailable','CONTENT_UNSUPPORTED'} end
    state = states[i-1]
  end
end
return {'observed',redis.call('HMGET',KEYS[1],unpack(fields)),total,state}
`

/** Board formatting uses bounded observations, never BullMQ's whole-hash Job loader. */
export class BoundedBullMQAdapter extends BullMQAdapter {
  private summary?: Promise<{ counts: JobCounts; paused: boolean; legacyPaused: boolean }>
  constructor(
    private readonly observedQueue: Queue,
    private readonly control: ControlConnection
  ) {
    super(observedQueue, { readOnlyMode: true, allowRetries: false })
  }

  override async getJob(id: string): Promise<Job | undefined> {
    workJobIdSchema.parse(id)
    const result = await this.control.withClient((client) =>
      client.eval(
        BOARD_JOB_LUA,
        9,
        this.observedQueue.toKey(id),
        ...COUNT_STATES.map((state) => this.observedQueue.toKey(state)),
        id
      )
    )
    if (!Array.isArray(result)) throw new Error('INVALID_BROKER_REPLY')
    const observation = decodeBoundedJob(result.slice(0, 3))
    if (observation.status !== 'observed') {
      if (observation.reason === 'HISTORY_EXPIRED') return undefined
      throw new Error(observation.reason)
    }
    const state = z
      .enum([
        'unknown',
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'prioritized',
        'waiting-children',
      ])
      .parse(result[3])
    return this.observedJob(observation.fields, id, state)
  }

  override async getJobs(statuses: JobStatus[], start = 0, end = 49): Promise<Job[]> {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= 512 ||
      end - start >= 50
    )
      throw new Error('READ_LIMIT')
    const limit = end - start + 1
    if (start % limit !== 0) throw new Error('READ_LIMIT')
    const selected: { id: string; state: string }[] = []
    for (const status of statuses) {
      if (selected.length >= limit) break
      const state = status === 'paused' ? 'waiting' : status
      const pagination = workListQuerySchema.parse({ page: start / limit + 1, limit })
      const query = { ...pagination, state }
      const queue = await this.queueSummary()
      const ids = await this.control.withClient(async (client) => {
        // Read the fixed first window; an arbitrary offset never reaches Redis.
        const window = await readJobWindow(client, this.observedQueue, query, queue.legacyPaused)
        if ('reason' in window) throw new Error(window.reason)
        return window.ids
      })
      const seen = new Set(selected.map(({ id }) => id))
      selected.push(
        ...ids
          .filter((id) => !seen.has(id))
          .slice(0, limit - selected.length)
          .map((id) => ({ id, state }))
      )
    }
    const observations = await this.control.withClient((client) =>
      readBoundedJobPage(
        client,
        selected.map(({ id }) => this.observedQueue.toKey(id))
      )
    )
    return observations.jobs.map((observation, index) => {
      if (observation.status !== 'observed') throw new Error(observation.reason)
      const selectedJob = selected[index]!
      return this.observedJob(observation.fields, selectedJob.id, selectedJob.state)
    })
  }

  private observedJob(
    fields: Readonly<Record<string, string | null>>,
    id: string,
    state: string
  ): Job {
    const number = (field: string): number =>
      z.coerce
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(fields[field] ?? 0)
    const job = Job.fromJSON(
      this.observedQueue,
      {
        id,
        name: z.string().min(1).max(64).parse(fields.name),
        data: fields.data ?? '{}',
        opts: JSON.parse(fields.opts ?? '{}'),
        progress: JSON.parse(fields.progress ?? '0'),
        timestamp: number('timestamp'),
        attemptsMade: number('atm'),
        attemptsStarted: number('ats'),
        stalledCounter: 0,
        delay: number('delay'),
        priority: number('priority'),
        ...(fields.finishedOn === null ? {} : { finishedOn: number('finishedOn') }),
        ...(fields.processedOn === null ? {} : { processedOn: number('processedOn') }),
        failedReason: fields.failedReason ?? '',
        returnvalue: '',
      },
      id
    )
    job.getState = async () => state as Awaited<ReturnType<Job['getState']>>
    return job
  }

  private queueSummary(): Promise<{ counts: JobCounts; paused: boolean; legacyPaused: boolean }> {
    // Bull Board asks both concurrently. Share this one read, never two nested leases.
    if (this.summary) return this.summary
    this.summary = this.control
      .withClient(async (client) => {
        const result = await client.eval(
          COUNTS_LUA,
          COUNT_STATES.length + 1,
          ...COUNT_STATES.map((state) => this.observedQueue.toKey(state)),
          this.observedQueue.toKey('meta')
        )
        const counts = z
          .array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER))
          .length(COUNT_STATES.length + 1)
          .parse(result)
        return {
          paused: counts[8] === 1,
          legacyPaused: counts[1]! > 0 && counts[0] === 0,
          counts: {
            waiting: counts[0]! + counts[1]!,
            paused: counts[1]!,
            active: counts[2]!,
            completed: counts[3]!,
            failed: counts[4]!,
            delayed: counts[5]!,
            prioritized: counts[6]!,
            'waiting-children': counts[7]!,
          },
        }
      })
      .finally(() => {
        this.summary = undefined
      })
    return this.summary
  }

  override async getJobCounts(): Promise<JobCounts> {
    return (await this.queueSummary()).counts
  }
  override async isPaused(): Promise<boolean> {
    return (await this.queueSummary()).paused
  }

  override async getGlobalConcurrency(): Promise<null> {
    return null
  }
  override get supportsGlobalRateLimit(): boolean {
    return false
  }
  override async getActiveRateLimitTtl(): Promise<number> {
    return 0
  }
  override async getJobSchedulersCount(): Promise<number> {
    return 0
  }
}
