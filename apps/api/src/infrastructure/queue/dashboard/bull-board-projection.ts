import { BOARD_HIDDEN, boardCopy, type BoardLocale } from './bull-board-copy'
import { BOARD_DATA_PROJECTIONS } from './bull-board-data-projections'

/**
 * Closed projection of the Bull Board wire envelopes (`GetQueuesResponse`, `GetJobResponse`).
 *
 * Every function REBUILDS its object from an explicit list of fields: nothing is spread and nothing
 * is passed through as-is, so a field a newer Board version adds never reaches the browser. Required
 * schema fields are replaced by typed neutral values, optional ones are dropped; the result still
 * satisfies the Board's own response schema (`validateResponses` checks it). Field lists are pinned
 * to the installed schemas by `bull-board-upgrade-guard.spec.ts`.
 */
export interface ProjectionContext {
  readonly locale?: BoardLocale
}

export const BOARD_STATUSES = [
  'latest',
  'active',
  'waiting',
  'waiting-children',
  'prioritized',
  'completed',
  'failed',
  'delayed',
  'paused',
] as const
type BoardStatus = (typeof BOARD_STATUSES)[number]

const JOB_STATES = [...BOARD_STATUSES, 'stuck', 'unknown'] as const
const QUEUE_TYPES = ['bull', 'bullmq'] as const
const BACKOFF_TYPES = ['fixed', 'exponential'] as const
const JOB_ID = /^[A-Za-z0-9:_.-]{1,128}$/
const JOB_NAME = /^[A-Za-z0-9._:-]{1,64}$/

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function int(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

export function pickCounts(raw: unknown): Record<string, number> {
  const source = isRecord(raw) ? raw : {}
  const counts: Record<string, number> = {}
  for (const status of BOARD_STATUSES) {
    const value = source[status]
    if (typeof value === 'number' && Number.isFinite(value)) counts[status] = value
  }
  return counts
}

export function pickPagination(raw: unknown): {
  pageCount: number
  range: { start: number; end: number }
} {
  const source = isRecord(raw) ? raw : {}
  const range = isRecord(source.range) ? source.range : {}
  return {
    pageCount: num(source.pageCount),
    range: { start: num(range.start), end: num(range.end) },
  }
}

function retention(
  value: unknown
): boolean | number | { age?: number; count?: number } | undefined {
  if (typeof value === 'boolean') return value
  if (int(value) !== undefined) return value as number
  if (!isRecord(value)) return undefined
  const kept: { age?: number; count?: number } = {}
  const age = int(value.age)
  const count = int(value.count)
  if (age !== undefined) kept.age = age
  if (count !== undefined) kept.count = count
  return kept
}

/** Only retry/delay/retention knobs of the job options: typed, bounded, nothing arbitrary. */
export function pickOpts(raw: unknown): Json {
  if (!isRecord(raw)) return {}
  const opts: Json = {}
  const attempts = int(raw.attempts)
  if (attempts !== undefined) opts.attempts = attempts
  const delay = int(raw.delay)
  if (delay !== undefined) opts.delay = delay
  const priority = int(raw.priority)
  if (priority !== undefined) opts.priority = priority
  if (typeof raw.lifo === 'boolean') opts.lifo = raw.lifo
  const backoff = raw.backoff
  if (int(backoff) !== undefined) {
    opts.backoff = backoff
  } else if (isRecord(backoff)) {
    const type = oneOf(backoff.type, BACKOFF_TYPES)
    const backoffDelay = int(backoff.delay)
    if (type && backoffDelay !== undefined) opts.backoff = { type, delay: backoffDelay }
  }
  for (const key of ['removeOnComplete', 'removeOnFail'] as const) {
    const kept = retention(raw[key])
    if (kept !== undefined) opts[key] = kept
  }
  return opts
}

/** The board queue name maps back to a code-owned queue name; anything else hides its payloads. */
function projectData(queueName: unknown, data: unknown): unknown {
  const projection =
    typeof queueName === 'string' ? BOARD_DATA_PROJECTIONS.get(queueName) : undefined
  if (!projection) return BOARD_HIDDEN
  return projection(data) ?? BOARD_HIDDEN
}

export function pickJob(raw: unknown, queueName: unknown, context: ProjectionContext): Json {
  const source = isRecord(raw) ? raw : {}
  const job: Json = {
    name:
      text(source.name, 64) && JOB_NAME.test(source.name as string) ? source.name : BOARD_HIDDEN,
    timestamp: num(source.timestamp),
    progress:
      typeof source.progress === 'number' && Number.isFinite(source.progress) ? source.progress : 0,
    attempts: num(source.attempts),
    stacktrace: [],
    opts: pickOpts(source.opts),
    data: projectData(queueName, source.data),
    returnValue: BOARD_HIDDEN,
    isFailed: source.isFailed === true,
  }
  const id = source.id
  if (typeof id === 'string' && JOB_ID.test(id)) job.id = id
  else if (typeof id === 'number' && Number.isFinite(id)) job.id = id
  for (const key of ['processedOn', 'finishedOn'] as const) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) job[key] = value
  }
  const delay = int(source.delay)
  if (delay !== undefined) job.delay = delay
  if (source.isFailed === true || typeof source.failedReason === 'string') {
    job.failedReason = boardCopy(context.locale).failureHidden
  }
  return job
}

export function pickQueue(raw: unknown, context: ProjectionContext): Json {
  const source = isRecord(raw) ? raw : {}
  const name = source.name
  const jobs = Array.isArray(source.jobs) ? source.jobs : []
  const queue: Json = {
    delimiter:
      typeof source.delimiter === 'string' && source.delimiter.length <= 4 ? source.delimiter : ':',
    name: typeof name === 'string' ? name : BOARD_HIDDEN,
    counts: pickCounts(source.counts),
    jobs: jobs.map((job) => pickJob(job, name, context)),
    statuses: (Array.isArray(source.statuses) ? source.statuses : []).filter(
      (status): status is BoardStatus => oneOf(status, BOARD_STATUSES) !== undefined
    ),
    pagination: pickPagination(source.pagination),
    // Fixed capabilities: the board is read-only whatever the adapter says.
    readOnlyMode: true,
    allowRetries: false,
    allowCompletedRetries: false,
    isPaused: source.isPaused === true,
    type: oneOf(source.type, QUEUE_TYPES) ?? 'bullmq',
    globalConcurrency: null,
    activeRateLimitTtl: 0,
    supportsGlobalRateLimit: false,
    jobSchedulerCount: 0,
    hasWorkers: null,
  }
  const displayName = text(source.displayName, 64)
  if (displayName) queue.displayName = displayName
  const description = text(source.description, 200)
  if (description) queue.description = description
  return queue
}

export function projectQueuesBody(body: unknown, context: ProjectionContext): Json {
  const queues = isRecord(body) && Array.isArray(body.queues) ? body.queues : []
  return { queues: queues.map((queue) => pickQueue(queue, context)) }
}

export function projectJobBody(
  body: unknown,
  queueName: unknown,
  context: ProjectionContext
): Json {
  const source = isRecord(body) ? body : {}
  return {
    job: pickJob(source.job, queueName, context),
    status: oneOf(source.status, JOB_STATES) ?? 'unknown',
  }
}
