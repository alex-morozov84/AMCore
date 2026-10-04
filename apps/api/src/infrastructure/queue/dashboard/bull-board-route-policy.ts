import { BOARD_STATUSES } from './bull-board-projection'

/**
 * Which requests the board mount accepts, decided from the method and the path alone (before any
 * Board code runs). Everything not listed is closed: a route a newer Board version adds is a 404
 * until it is reviewed and added here (`bull-board-upgrade-guard.spec.ts` pins the installed set).
 *
 * The board is a view: only GET/HEAD exist. It shows queues with their jobs and one job's details;
 * job logs are answered with a fixed message without reading them; flows, schedulers, default
 * options, rate limits, workers, Redis stats and metrics are closed.
 */
export type BoardRouteDecision =
  | { readonly kind: 'pass'; readonly entry: boolean }
  | { readonly kind: 'synthetic'; readonly channel: 'logs' }
  | { readonly kind: 'reject'; readonly status: 400 | 404 }

const QUEUE_SEGMENT = /^[A-Za-z0-9:_-]{1,64}$/
const JOB_SEGMENT = /^[A-Za-z0-9:_.-]{1,128}$/
const STATIC_PATH = /^\/static\/[A-Za-z0-9._/-]{1,200}$/

/**
 * Second path segments under `/api/queues/:queue/` that are Board routes of their own; a job with
 * such an id is not viewable here, so a closed channel can never be reached as a "job".
 */
const RESERVED_JOB_SEGMENTS: ReadonlySet<string> = new Set([
  'add',
  'clean',
  'concurrency',
  'default-job-options',
  'empty',
  'job-data-schema',
  'job-schedulers',
  'metrics',
  'obliterate',
  'pause',
  'promote',
  'rate-limit',
  'resume',
  'retry',
  'workers',
])

const QUERY_KEYS = new Set(['activeQueue', 'status', 'page', 'jobsPerPage'])
export const BOARD_MAX_JOBS_PER_PAGE = 50
const BOARD_MAX_PAGE = 10_000

const REJECT_404 = { kind: 'reject', status: 404 } as const
const REJECT_400 = { kind: 'reject', status: 400 } as const

function boundedInteger(value: string, maximum: number): boolean {
  return /^[0-9]{1,6}$/.test(value) && Number(value) >= 1 && Number(value) <= maximum
}

/** Query of `GET /api/queues`: known keys only, each once, bounded values. */
export function isValidQueuesQuery(query: URLSearchParams): boolean {
  const seen = new Set<string>()
  for (const [key, value] of query) {
    if (!QUERY_KEYS.has(key) || seen.has(key)) return false
    seen.add(key)
    if (key === 'activeQueue' && !QUEUE_SEGMENT.test(value)) return false
    if (key === 'status' && !(BOARD_STATUSES as readonly string[]).includes(value)) return false
    if (key === 'page' && !boundedInteger(value, BOARD_MAX_PAGE)) return false
    if (key === 'jobsPerPage' && !boundedInteger(value, BOARD_MAX_JOBS_PER_PAGE)) return false
  }
  return true
}

/** `path` is the raw, undecoded request path relative to the mount (e.g. `/api/queues`). */
export function decideBoardRoute(path: string, query: URLSearchParams): BoardRouteDecision {
  // No percent-encoding anywhere: every allowed segment is plain, so an encoded slash/dot is hostile.
  if (path.includes('%') || path.includes('\\') || path.includes('//') || path.includes('..')) {
    return REJECT_404
  }
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path

  if (trimmed === '/') return { kind: 'pass', entry: true }
  if (STATIC_PATH.test(trimmed)) return { kind: 'pass', entry: false }

  const parts = trimmed.split('/').slice(1)
  if (parts[0] === 'queue') {
    const [, queue, job, ...rest] = parts
    if (rest.length > 0 || !queue || !QUEUE_SEGMENT.test(queue)) return REJECT_404
    if (job !== undefined && !JOB_SEGMENT.test(job)) return REJECT_404
    return { kind: 'pass', entry: true }
  }

  if (parts[0] === 'api' && parts[1] === 'queues') {
    if (parts.length === 2) {
      return isValidQueuesQuery(query) ? { kind: 'pass', entry: false } : REJECT_400
    }
    const [, , queue, job, leaf, ...rest] = parts
    if (rest.length > 0 || !queue || !QUEUE_SEGMENT.test(queue)) return REJECT_404
    if (!job || !JOB_SEGMENT.test(job) || RESERVED_JOB_SEGMENTS.has(job)) return REJECT_404
    if (leaf === undefined) return { kind: 'pass', entry: false }
    if (leaf === 'logs') return { kind: 'synthetic', channel: 'logs' }
  }
  return REJECT_404
}
