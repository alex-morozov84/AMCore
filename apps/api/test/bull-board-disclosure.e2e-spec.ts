import { BULL_BOARD_ADAPTER } from '@bull-board/nestjs'
import { jest } from '@jest/globals'
import type { INestApplication } from '@nestjs/common'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import request from 'supertest'

import { BULL_BOARD_CONTENT_SECURITY_POLICY, SUPPORTED_LOCALES } from '@amcore/shared'

import { BOARD_HOOKS } from '../src/infrastructure/queue/dashboard/bull-board-hooks'
import type { PrismaService } from '../src/prisma'

import { BOARD, CANARY, failOneJob, queueOf, superAdminCookie } from './bull-board.helper'
import {
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

/**
 * What the board shows, proven on the RAW JSON of the real mount: every channel carries a canary and
 * the canary must never come back. Not a DOM check, not a formatter check.
 */
// A supported locale, not a spelled-out one: a fork that keeps a single locale supports only that.
const JOB_LOCALE = SUPPORTED_LOCALES[SUPPORTED_LOCALES.length - 1]
const REAL_EMAIL_JOB = {
  template: 'welcome',
  to: `${CANARY}@example.com`,
  userId: 'user-1',
  data: { name: `Name ${CANARY}`, email: `${CANARY}@example.com`, locale: JOB_LOCALE },
}
const HOUR = 3_600_000
const EXPECTED_QUEUE_KEYS = [
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
]
const EXPECTED_JOB_KEYS = [
  'attempts',
  'data',
  'delay',
  'failedReason',
  'finishedOn',
  'id',
  'isFailed',
  'name',
  'opts',
  'processedOn',
  'progress',
  'returnValue',
  'stacktrace',
  'timestamp',
]
const CLOSED_PATHS = [
  '/api/redis/stats',
  '/api/job-schedulers',
  '/api/queues/email/workers',
  '/api/queues/email/metrics',
  '/api/queues/email/default-job-options',
  '/api/queues/email/rate-limit',
  '/api/queues/email/job-data-schema',
  '/api/queues/email/job-schedulers',
  '/api/metrics/history',
  '/api/metrics/latency',
  '/metrics-history',
  '/job-schedulers',
]

describe('Bull Board discloses only the reviewed data (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let cookie: string
  let failedJobId: string

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
    cookie = await superAdminCookie(app, prisma)
    await queueOf(app, 'email').add('send-email', REAL_EMAIL_JOB, {
      delay: HOUR,
      jobId: 'email-job-1',
    })
    await queueOf(app, 'notifications').add(
      'dispatch-due',
      { notificationId: 'ntf-1' },
      { delay: HOUR, jobId: 'ntf-job-1' }
    )
    await queueOf(app, 'ai-runs').add(
      'ai-run-wake',
      { runId: 'run-1', prompt: CANARY },
      { delay: HOUR, jobId: 'ai-job-1' }
    )
    const failed = await failOneJob(
      queueOf(app, 'default'),
      { token: CANARY, nested: { deep: CANARY } },
      process.env.REDIS_URL!
    )
    failedJobId = String(failed.id)
    await queueOf(app, 'default').upsertJobScheduler(
      'canary-scheduler',
      { every: HOUR },
      { name: 'template', data: { token: CANARY }, opts: { attempts: 2 } }
    )
  }, 180000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    // Users are recreated per test file; keep the seeded session.
    await cleanOrgData(prisma).catch(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const get = (path: string) =>
    request(app.getHttpServer()).get(`${BOARD}${path}`).set('Cookie', cookie)

  it('shows an email job as template, locale and opaque user id only', async () => {
    const res = await get('/api/queues?activeQueue=email&status=delayed').expect(200)
    const raw = JSON.stringify(res.body)
    expect(raw).not.toContain(CANARY)
    expect(raw).not.toContain('@example.com')
    const queue = res.body.queues.find((q: { name: string }) => q.name === 'email')
    expect(queue.jobs).toHaveLength(1)
    expect(queue.jobs[0].data).toEqual({
      template: 'welcome',
      locale: JOB_LOCALE,
      userId: 'user-1',
    })
    expect(queue.jobs[0].returnValue).toBe('[hidden]')
    expect(queue.jobs[0].stacktrace).toEqual([])
  })

  it('shows a notification wake job as its opaque id', async () => {
    const res = await get('/api/queues?activeQueue=notifications&status=delayed').expect(200)
    const queue = res.body.queues.find((q: { name: string }) => q.name === 'notifications')
    expect(queue.jobs[0].data).toEqual({ notificationId: 'ntf-1' })
  })

  it('shows an AI run wake job as its opaque run id and nothing else', async () => {
    const res = await get('/api/queues?activeQueue=ai-runs&status=delayed').expect(200)
    const queue = res.body.queues.find((q: { name: string }) => q.name === 'ai-runs')
    expect(queue.jobs[0].data).toEqual({ runId: 'run-1' })
    expect(JSON.stringify(queue)).not.toContain(CANARY)
  })

  it('hides the whole payload of the downstream default queue and every failure detail', async () => {
    const res = await get('/api/queues?activeQueue=default&status=failed').expect(200)
    expect(JSON.stringify(res.body)).not.toContain(CANARY)
    const queue = res.body.queues.find((q: { name: string }) => q.name === 'default')
    const job = queue.jobs[0]
    expect(job.data).toBe('[hidden]')
    expect(job.isFailed).toBe(true)
    expect(job.failedReason).toBe('Failure details are not displayed in this board.')
    expect(job.stacktrace).toEqual([])
    expect(job.returnValue).toBe('[hidden]')
  })

  it('serves a job detail through the same projection', async () => {
    const res = await get(`/api/queues/default/${failedJobId}`).expect(200)
    expect(JSON.stringify(res.body)).not.toContain(CANARY)
    expect(Object.keys(res.body).sort()).toEqual(['job', 'status'])
    expect(res.body.job.data).toBe('[hidden]')
  })

  it('rebuilds each envelope from a closed list of fields', async () => {
    const res = await get('/api/queues?activeQueue=default&status=failed').expect(200)
    expect(Object.keys(res.body)).toEqual(['queues'])
    for (const queue of res.body.queues) {
      expect(Object.keys(queue).every((key) => EXPECTED_QUEUE_KEYS.includes(key))).toBe(true)
      expect(queue).toMatchObject({ readOnlyMode: true, allowRetries: false, hasWorkers: null })
      for (const job of queue.jobs) {
        expect(Object.keys(job).every((key) => EXPECTED_JOB_KEYS.includes(key))).toBe(true)
      }
    }
  })

  it('answers job logs with a fixed message without reading them', async () => {
    const readLogs = jest.spyOn(Queue.prototype, 'getJobLogs')
    const res = await get(`/api/queues/default/${failedJobId}/logs`).expect(200)
    expect(res.body).toEqual(['Logs are not displayed in this board.'])
    expect(JSON.stringify(res.body)).not.toContain(CANARY)
    expect(readLogs).not.toHaveBeenCalled()
  })

  it('answers the job flow with the board\'s own "not part of a flow" reply, reading nothing', async () => {
    const readJob = jest.spyOn(Queue.prototype, 'getJob')
    const res = await get(`/api/queues/default/${failedJobId}/flow`).expect(200)
    expect(res.body).toEqual({ nodeId: failedJobId, isFlowNode: false, flowRoot: null })
    expect(readJob).not.toHaveBeenCalled()
  })

  it.each(CLOSED_PATHS)('keeps %s closed', async (path) => {
    const res = await get(path.replace('JOBID', failedJobId))
    expect(res.status).toBe(404)
    expect(res.text).not.toContain(CANARY)
    expect(res.body).toEqual({ error: { key: 'ERRORS.QUEUE_NOT_FOUND' } })
  })

  it('rejects an unbounded or unknown query', async () => {
    for (const query of ['jobsPerPage=100000', 'page=0', 'status=bogus', 'foo=1']) {
      const res = await get(`/api/queues?${query}`)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: { key: 'ERRORS.INVALID_QUERY_PARAM' } })
    }
  })

  it('answers every response with the board headers, a single CSP and no caching', async () => {
    for (const path of ['/', '/api/queues', '/static/js/does-not-matter.js', '/nope']) {
      const res = await get(path)
      expect(res.headers['content-security-policy']).toBe(BULL_BOARD_CONTENT_SECURITY_POLICY)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['x-frame-options']).toBe('DENY')
      expect(res.headers['referrer-policy']).toBe('no-referrer')
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
      expect(res.headers['cache-control']).toMatch(/^private, no-(store|cache)$/)
    }
  })

  describe('errors never leave the board', () => {
    it('reduces the Boards own response-schema mismatch to a key, dropping the validator text', async () => {
      // The projection yields a body that violates the Board schema: the Board answers
      // RESPONSE_SCHEMA_MISMATCH with the validator's issue text, which names the offending value.
      jest.spyOn(BOARD_HOOKS, 'after').mockImplementation((_context, result) => ({
        status: result.status,
        body: {
          queues: [
            { name: 'email', pagination: { pageCount: CANARY, range: { start: 0, end: 0 } } },
          ],
        },
      }))
      const res = await get('/api/queues')
      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: { key: 'ERRORS.INTERNAL_SERVER_ERROR' } })
      expect(res.text).not.toContain(CANARY)
      expect(res.text).not.toContain('RESPONSE_SCHEMA_MISMATCH')
      const head = await request(app.getHttpServer())
        .head(`${BOARD}/api/queues`)
        .set('Cookie', cookie)
      expect(head.status).toBe(500)
      expect(head.text ?? '').toBe('')
    })

    it('reduces a thrown error to a key', async () => {
      jest.spyOn(Queue.prototype, 'getJobCounts').mockRejectedValue(new Error(`boom ${CANARY}`))
      for (const send of [
        () => get('/api/queues'),
        () => request(app.getHttpServer()).head(`${BOARD}/api/queues`).set('Cookie', cookie),
      ]) {
        const res = await send()
        expect(res.status).toBe(500)
        expect(res.text ?? '').not.toContain(CANARY)
        expect(res.text ? res.body : { error: { key: 'ERRORS.INTERNAL_SERVER_ERROR' } }).toEqual({
          error: { key: 'ERRORS.INTERNAL_SERVER_ERROR' },
        })
      }
    })
  })

  describe('the HTML entry page', () => {
    const ENTRIES = ['/', '/queue/email', '/queue/email/email-job-1']

    type Engine = (
      path: string,
      options: object,
      callback: (error: Error | null, html?: string) => void
    ) => void
    function router(): { engine(ext: string, fn: Engine): void; engines: Record<string, Engine> } {
      return (app.get(BULL_BOARD_ADAPTER, { strict: false }) as { getRouter(): never }).getRouter()
    }

    async function withEngine<T>(replacement: Engine, run: () => Promise<T>): Promise<T> {
      const original = router().engines['.ejs']!
      router().engine('ejs', replacement)
      try {
        return await run()
      } finally {
        router().engine('ejs', original)
      }
    }

    const asyncFailure: Engine = (_path, _options, callback) => {
      setImmediate(() => callback(new Error(`render ${CANARY} at /srv/app/views/index.ejs`)))
    }
    const syncFailure: Engine = () => {
      throw new Error(`render ${CANARY} at /srv/app/views/index.ejs`)
    }

    it.each([
      ['asynchronous', asyncFailure],
      ['synchronous', syncFailure],
    ])('answers an %s render failure with a fixed 500 on GET and HEAD', async (_label, engine) => {
      await withEngine(engine, async () => {
        for (const path of ENTRIES) {
          const res = await get(path)
          expect(res.status).toBe(500)
          expect(res.body).toEqual({ error: { key: 'ERRORS.INTERNAL_SERVER_ERROR' } })
          expect(res.text).not.toContain(CANARY)
          expect(res.text).not.toContain('/srv/app')
          expect(res.text).not.toContain('node_modules')
          expect(res.headers['content-security-policy']).toBe(BULL_BOARD_CONTENT_SECURITY_POLICY)
          expect(res.headers['cache-control']).toBe('private, no-store')

          const head = await request(app.getHttpServer())
            .head(`${BOARD}${path}`)
            .set('Cookie', cookie)
          expect(head.status).toBe(500)
          expect(head.text ?? '').toBe('')
        }
      })
    })

    it('renders the page when the engine works, with the headers of every board response', async () => {
      for (const path of ENTRIES) {
        const res = await get(path)
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toMatch(/text\/html/)
        expect(res.text).toContain('<base href="/admin/queues/"')
        expect(res.text).toContain('__UI_CONFIG__')
        expect(res.text).toContain('READ-ONLY')
        expect(res.headers['content-security-policy']).toBe(BULL_BOARD_CONTENT_SECURITY_POLICY)
        expect(res.headers['cache-control']).toBe('private, no-store')
        const head = await request(app.getHttpServer())
          .head(`${BOARD}${path}`)
          .set('Cookie', cookie)
        expect(head.status).toBe(200)
        expect(head.text ?? '').toBe('')
      }
    })
  })

  describe('internal effects of the read endpoints', () => {
    const WRITE_COMMANDS = new Set([
      'set',
      'setex',
      'del',
      'unlink',
      'rpush',
      'lpush',
      'rpop',
      'lpop',
      'lmove',
      'blmove',
      'brpoplpush',
      'zadd',
      'zrem',
      'zincrby',
      'hset',
      'hdel',
      'hincrby',
      'sadd',
      'srem',
      'xadd',
      'xdel',
      'publish',
      'expire',
      'pexpire',
      'incr',
      'decr',
    ])

    it('only performs the one known BullMQ-internal write, on a legacy marker', async () => {
      const redis = new IORedis(process.env.REDIS_URL!)
      const monitor = await redis.monitor()
      const seen: Array<{ command: string; key: string }> = []
      monitor.on('monitor', (_time: string, args: string[]) => {
        seen.push({ command: String(args[0]).toLowerCase(), key: String(args[1] ?? '') })
      })
      // MONITOR delivers asynchronously: a sentinel write marks where the stream has caught up.
      const checkpoint = async (name: string): Promise<void> => {
        await redis.set(`board-sentinel:${name}`, '1')
        const deadline = Date.now() + 5000
        while (!seen.some((entry) => entry.key === `board-sentinel:${name}`)) {
          if (Date.now() > deadline) throw new Error(`monitor did not reach ${name}`)
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      try {
        // A pre-v5 waitlist marker as the last element of the list: `getCounts` pops it.
        await redis.rpush('amcore:default:wait', '0:0')
        await redis.lpush('amcore:default:wait', 'legacy-job-id')
        await checkpoint('before')
        seen.length = 0
        await get('/api/queues?activeQueue=default&status=failed').expect(200)
        await get(`/api/queues/default/${failedJobId}`).expect(200)
        await checkpoint('after')
        const writes = seen.filter(
          (entry) => WRITE_COMMANDS.has(entry.command) && !entry.key.startsWith('board-sentinel:')
        )
        expect(writes.map((entry) => `${entry.command} ${entry.key}`)).toEqual([
          'rpop amcore:default:wait',
        ])
      } finally {
        monitor.disconnect()
        redis.disconnect()
      }
    })
  })
})
