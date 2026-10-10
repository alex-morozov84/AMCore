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

/** A value that must never appear anywhere the queue board shows or sends. */
export const BOARD_CANARY = 'E2E_BOARD_CANARY_5c1d'
const FAILED_ID = 'e2e-failed'

/**
 * A failed job as BullMQ writes it, with the canary in every channel the board could leak: payload,
 * failure text and stack trace (with a file path). The board must show none of them.
 */
export function addFailedDefaultQueueJob(): string {
  const now = String(Date.now())
  redis(
    'HSET',
    key(FAILED_ID),
    'name',
    'e2e',
    'data',
    JSON.stringify({ token: BOARD_CANARY }),
    'opts',
    '{"attempts":1}',
    'timestamp',
    now,
    'processedOn',
    now,
    'finishedOn',
    now,
    'atm',
    '1',
    'failedReason',
    `boom ${BOARD_CANARY}`,
    'stacktrace',
    JSON.stringify([`Error: boom ${BOARD_CANARY}\n    at /srv/app/secret.js:1`])
  )
  redis('ZADD', key('failed'), now, FAILED_ID)
  return FAILED_ID
}

/** Nonzero hidden diagnostics: the browser must never imply that these settings are absent. */
export function seedBoardDiagnostics(): void {
  redis('HSET', key('meta'), 'concurrency', '3', 'max', '7', 'duration', '60000')
  redis('SET', key('limiter'), '7', 'PX', '60000')
  redis('ZADD', key('repeat'), String(Date.now() + 60000), 'e2e-scheduler')
  redis(
    'HSET',
    key(FAILED_ID),
    'progress',
    JSON.stringify({ phase: BOARD_CANARY }),
    'parentKey',
    key('e2e-parent'),
    'parent',
    JSON.stringify({ id: 'e2e-parent', queueKey: key('') })
  )
  redis('SADD', `${key(FAILED_ID)}:dependencies`, key('e2e-child'))
  redis(
    'HSET',
    key('e2e-parent'),
    'name',
    'e2e',
    'data',
    '{}',
    'opts',
    '{}',
    'timestamp',
    String(Date.now())
  )
  redis('SADD', `${key('e2e-parent')}:dependencies`, key(FAILED_ID))
  redis('ZADD', key('waiting-children'), String(Date.now()), 'e2e-parent')
}

export function clearDefaultQueue(): void {
  const jobKeys = [...ids(50), 'e2e-extra', FAILED_ID].map((id) => key(id))
  // Preserve the live registration's epoch/protocol/control revision. Deleting meta
  // would create an unsupported layout instead of the modern queue this fixture tests.
  redis(
    'DEL',
    key('wait'),
    key('failed'),
    key('limiter'),
    key('repeat'),
    key('waiting-children'),
    key('e2e-parent'),
    `${key('e2e-parent')}:dependencies`,
    `${key(FAILED_ID)}:dependencies`,
    ...jobKeys
  )
  redis('HDEL', key('meta'), 'paused', 'concurrency', 'max', 'duration')
}
