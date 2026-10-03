import { guardedExec } from './managed-target.mjs'

/**
 * Seeds the `default` queue (the one stock queue without a processor, so nothing consumes the
 * jobs) through the managed stand's admitted `redis-cli`. The raw key layout is the one BullMQ 6
 * writes; `apps/api/test/queue-observation.e2e-spec.ts` proves the Console reads it exactly like a
 * BullMQ-created job.
 */
const QUEUE = 'default'
const key = (suffix: string) => `amcore:${QUEUE}:${suffix}`
const redis = (...args: string[]) => guardedExec('redis', 'redis-cli', ...args)
const ids = (count: number) => Array.from({ length: count }, (_, index) => `e2e-${index}`)

export interface QueueFixture {
  waiting: number
  /** Creation age of the oldest seeded job. */
  oldestSeconds: number
  paused: boolean
}

export function seedDefaultQueue({ waiting, oldestSeconds, paused }: QueueFixture): void {
  clearDefaultQueue()
  const now = Date.now()
  ids(waiting).forEach((id, index) => {
    const age = oldestSeconds - index * 10
    redis('HSET', key(id), 'name', 'e2e', 'data', '{}', 'timestamp', String(now - age * 1000))
    redis('LPUSH', key('wait'), id)
  })
  if (paused) redis('HSET', key('meta'), 'paused', '1')
}

export function addDefaultQueueJob(id: string): void {
  redis('HSET', key(id), 'name', 'e2e', 'data', '{}', 'timestamp', String(Date.now()))
  redis('LPUSH', key('wait'), id)
}

export function clearDefaultQueue(): void {
  const jobKeys = [...ids(50), 'e2e-extra'].map((id) => key(id))
  redis('DEL', key('wait'), key('meta'), ...jobKeys)
}
