import { STATUSES } from '@bull-board/api/constants/statuses'
import { appRoutes } from '@bull-board/api/dist/routes.js'
import {
  appJobSchema,
  appQueueSchema,
  jobCountsSchema,
  paginationSchema,
} from '@bull-board/api/dist/schemas/domain.js'
import {
  getJobResponseSchema,
  getQueuesResponseSchema,
} from '@bull-board/api/dist/schemas/responses.js'

import { BOARD_STATUSES } from './bull-board-projection'

/**
 * Pins the installed Bull Board to the lists this boundary was reviewed against. A Board upgrade that
 * adds a route or a response field fails here; it then needs a deliberate decision (extend the list
 * and the projection, or leave it closed) instead of widening what the board shows.
 */
type RouteDef = { method: string | string[]; route: string | string[] }
const asList = (value: string | string[]): string[] => (Array.isArray(value) ? value : [value])

function describeRoutes(routes: RouteDef[]): string[] {
  return routes
    .flatMap((route) =>
      asList(route.method).flatMap((method) =>
        asList(route.route).map((path) => `${method.toUpperCase()} ${path}`)
      )
    )
    .sort()
}

const keysOf = (schema: unknown): string[] =>
  Object.keys((schema as { entries: Record<string, unknown> }).entries).sort()

describe('installed Bull Board vs the reviewed boundary', () => {
  it('has exactly the reviewed API routes', () => {
    expect(describeRoutes(appRoutes.api as unknown as RouteDef[])).toEqual(
      [
        'GET /api/redis/stats',
        'GET /api/queues',
        'GET /api/job-schedulers',
        'GET /api/queues/:queueName/metrics',
        'GET /api/queues/:queueName/default-job-options',
        'GET /api/queues/:queueName/workers',
        'GET /api/queues/:queueName/rate-limit',
        'GET /api/queues/:queueName/job-data-schema',
        'PUT /api/queues/pause',
        'PUT /api/queues/resume',
        'GET /api/queues/:queueName/:jobId/logs',
        'GET /api/queues/:queueName/:jobId/flow',
        'GET /api/queues/:queueName/:jobId',
        'POST /api/queues/:queueName/add',
        'PUT /api/queues/:queueName/retry/:queueStatus',
        'PUT /api/queues/:queueName/promote',
        'PUT /api/queues/:queueName/clean/:queueStatus',
        'PUT /api/queues/:queueName/pause',
        'PUT /api/queues/:queueName/resume',
        'PUT /api/queues/:queueName/concurrency',
        'PUT /api/queues/:queueName/rate-limit',
        'PUT /api/queues/:queueName/rate-limit/release',
        'PUT /api/queues/:queueName/empty',
        'PUT /api/queues/:queueName/obliterate',
        'PUT /api/queues/:queueName/job-schedulers/:schedulerId/remove',
        'PATCH /api/queues/:queueName/job-schedulers/:schedulerId',
        'PUT /api/queues/:queueName/job-schedulers/:schedulerId/run',
        'PUT /api/queues/:queueName/:jobId/retry',
        'PUT /api/queues/:queueName/:jobId/clean',
        'PUT /api/queues/:queueName/:jobId/promote',
        'PATCH /api/queues/:queueName/:jobId/update-data',
        'PATCH /api/queues/:queueName/:jobId/delay',
        'PATCH /api/queues/:queueName/:jobId/priority',
        'PUT /api/queues/:queueName/:jobId/remove-unprocessed-children',
      ].sort()
    )
  })

  it('has exactly the reviewed entry routes', () => {
    expect(asList(appRoutes.entryPoint.route).sort()).toEqual(
      [
        '/',
        '/job-schedulers',
        '/metrics-history',
        '/queue/:queueName',
        '/queue/:queueName/:jobId',
      ].sort()
    )
  })

  it('has exactly the reviewed response fields for each projected envelope', () => {
    expect(keysOf(getQueuesResponseSchema)).toEqual(['queues'])
    expect(keysOf(getJobResponseSchema)).toEqual(['job', 'status'])
    expect(keysOf(appQueueSchema)).toEqual(
      [
        'activeRateLimitTtl',
        'allowCompletedRetries',
        'allowRetries',
        'counts',
        'delimiter',
        'description',
        'displayName',
        'globalConcurrency',
        'hasWorkers',
        'isPaused',
        'jobSchedulerCount',
        'jobs',
        'name',
        'pagination',
        'readOnlyMode',
        'statuses',
        'supportsGlobalRateLimit',
        'type',
      ].sort()
    )
    expect(keysOf(appJobSchema)).toEqual(
      [
        'attempts',
        'attemptsStarted',
        'data',
        'deduplicationId',
        'deferredFailure',
        'delay',
        'externalUrl',
        'failedReason',
        'finishedOn',
        'groupId',
        'id',
        'isFailed',
        'name',
        'opts',
        'priority',
        'processedBy',
        'processedOn',
        'progress',
        'returnValue',
        'stacktrace',
        'stalledCounter',
        'timestamp',
      ].sort()
    )
    expect(keysOf(paginationSchema)).toEqual(['pageCount', 'range'])
  })

  it('counts are keyed by the reviewed statuses', () => {
    const picklist = (jobCountsSchema as unknown as { key: { options: string[] } }).key.options
    expect([...picklist].sort()).toEqual([...BOARD_STATUSES].sort())
    expect(Object.values(STATUSES).sort()).toEqual([...BOARD_STATUSES].sort())
  })
})
