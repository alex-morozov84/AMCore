import { boardCopy } from './bull-board-copy'
import {
  BOARD_STATUSES,
  pickCounts,
  pickJob,
  pickOpts,
  pickQueue,
  projectJobBody,
  projectQueuesBody,
} from './bull-board-projection'

const CANARY = 'CANARY_SECRET_VALUE'
const context = { locale: 'en' as const }

function rawJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '42',
    name: 'send-email',
    timestamp: 1_700_000_000_000,
    processedOn: 1_700_000_001_000,
    processedBy: `worker-${CANARY}`,
    finishedOn: 1_700_000_002_000,
    progress: 50,
    attempts: 2,
    delay: 0,
    failedReason: `smtp rejected ${CANARY}`,
    stacktrace: [`Error: ${CANARY}\n at /srv/app/secret.js:1`],
    opts: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      jobId: CANARY,
      custom: CANARY,
    },
    data: {
      template: 'welcome',
      to: `${CANARY}@example.com`,
      userId: 'u1',
      data: { name: CANARY },
    },
    returnValue: { token: CANARY },
    isFailed: true,
    externalUrl: { href: `https://x.example/${CANARY}` },
    groupId: CANARY,
    deduplicationId: CANARY,
    deferredFailure: CANARY,
    futureField: CANARY,
    ...overrides,
  }
}

function rawQueue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delimiter: ':',
    name: 'email',
    displayName: 'Email',
    description: 'Outgoing mail',
    counts: { waiting: 1, failed: 2, bogus: 9 },
    jobs: [rawJob()],
    statuses: ['latest', 'failed', 'weird'],
    pagination: { pageCount: 1, range: { start: 0, end: 9 }, extra: CANARY },
    readOnlyMode: false,
    allowRetries: true,
    allowCompletedRetries: true,
    isPaused: false,
    type: 'bullmq',
    globalConcurrency: 7,
    activeRateLimitTtl: 3,
    supportsGlobalRateLimit: true,
    jobSchedulerCount: 4,
    hasWorkers: true,
    futureQueueField: CANARY,
    ...overrides,
  }
}

describe('closed job projection', () => {
  const job = pickJob(rawJob(), 'email', context)

  it('carries no raw value anywhere', () => {
    expect(JSON.stringify(job)).not.toContain(CANARY)
    expect(JSON.stringify(job)).not.toContain('secret.js')
  })

  it('keeps the schema-required fields with neutral typed values', () => {
    expect(job).toMatchObject({
      name: 'send-email',
      timestamp: 1_700_000_000_000,
      progress: 50,
      attempts: 2,
      stacktrace: [],
      isFailed: true,
      returnValue: '[hidden]',
    })
  })

  it('replaces the failure text with the fixed message and keeps the failed flag', () => {
    expect(job.failedReason).toBe(boardCopy('en').failureHidden)
    expect(pickJob(rawJob(), 'email', { locale: 'ru' }).failedReason).toBe(
      boardCopy('ru').failureHidden
    )
  })

  it('omits the failure text for a job that did not fail', () => {
    const ok = pickJob(rawJob({ failedReason: undefined, isFailed: false }), 'email', context)
    expect(ok).not.toHaveProperty('failedReason')
    expect(ok.isFailed).toBe(false)
  })

  it('rebuilds data per queue and hides unknown queues', () => {
    expect(job.data).toEqual({ template: 'welcome', userId: 'u1' })
    expect(pickJob(rawJob(), 'default', context).data).toBe('[hidden]')
    expect(pickJob(rawJob(), 'my-reports', context).data).toBe('[hidden]')
    expect(pickJob(rawJob(), undefined, context).data).toBe('[hidden]')
  })

  it('drops the optional fields it does not list', () => {
    for (const key of [
      'processedBy',
      'externalUrl',
      'groupId',
      'deduplicationId',
      'deferredFailure',
      'futureField',
    ]) {
      expect(job).not.toHaveProperty(key)
    }
  })

  it('neutralises wrong types instead of passing them on', () => {
    const bad = pickJob(
      rawJob({
        name: { x: CANARY },
        timestamp: 'x',
        progress: { token: CANARY },
        attempts: null,
        id: { a: 1 },
      }),
      'email',
      context
    )
    expect(bad).toMatchObject({ name: '[hidden]', timestamp: 0, progress: 0, attempts: 0 })
    expect(bad).not.toHaveProperty('id')
    expect(JSON.stringify(bad)).not.toContain(CANARY)
  })

  it('hides a job name that is not a plain identifier', () => {
    expect(pickJob(rawJob({ name: `send ${CANARY} now` }), 'email', context).name).toBe('[hidden]')
  })
})

describe('job options projection', () => {
  it('keeps only typed retry, delay and retention knobs', () => {
    expect(pickOpts(rawJob().opts)).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    })
  })

  it.each([
    [{ attempts: '3' }, {}],
    [{ attempts: -1 }, {}],
    [{ backoff: { type: 'weird', delay: 5 } }, {}],
    [{ backoff: 'x' }, {}],
    [
      { removeOnComplete: { age: 10, count: 5, junk: CANARY } },
      { removeOnComplete: { age: 10, count: 5 } },
    ],
    [{ lifo: 'yes' }, {}],
    ['not an object', {}],
  ])('rejects bad value %#', (raw, expected) => {
    expect(pickOpts(raw)).toEqual(expected)
  })
})

describe('closed queue projection', () => {
  const queue = pickQueue(rawQueue(), context)

  it('drops unknown top-level, counts and pagination keys', () => {
    expect(JSON.stringify(queue)).not.toContain(CANARY)
    expect(queue.counts).toEqual({ waiting: 1, failed: 2 })
    expect(queue.pagination).toEqual({ pageCount: 1, range: { start: 0, end: 9 } })
    expect(queue.statuses).toEqual(['latest', 'failed'])
  })

  it('forces the read-only capabilities and neutral diagnostics', () => {
    expect(queue).toMatchObject({
      readOnlyMode: true,
      allowRetries: false,
      allowCompletedRetries: false,
      globalConcurrency: null,
      activeRateLimitTtl: 0,
      supportsGlobalRateLimit: false,
      jobSchedulerCount: 0,
      hasWorkers: null,
    })
  })

  it('keeps identity and bounded display text', () => {
    expect(queue).toMatchObject({
      name: 'email',
      displayName: 'Email',
      description: 'Outgoing mail',
      type: 'bullmq',
    })
    expect(pickQueue(rawQueue({ description: 'x'.repeat(201) }), context)).not.toHaveProperty(
      'description'
    )
  })

  it('survives garbage without throwing', () => {
    expect(() => projectQueuesBody(null, context)).not.toThrow()
    expect(projectQueuesBody('x', context)).toEqual({ queues: [] })
    expect(projectQueuesBody({ queues: [null, 5, 'x'] }, context)).toMatchObject({
      queues: [{ name: '[hidden]' }, { name: '[hidden]' }, { name: '[hidden]' }],
    })
  })

  it('projects every queue of a response and the job of a job response', () => {
    const queues = projectQueuesBody(
      { queues: [rawQueue(), rawQueue({ name: 'default' })], extra: CANARY },
      context
    )
    expect(Object.keys(queues)).toEqual(['queues'])
    expect(JSON.stringify(queues)).not.toContain(CANARY)
    const body = projectJobBody(
      { job: rawJob(), status: 'failed', extra: CANARY },
      'email',
      context
    )
    expect(Object.keys(body).sort()).toEqual(['job', 'status'])
    expect(body.status).toBe('failed')
    expect(JSON.stringify(body)).not.toContain(CANARY)
    expect(projectJobBody({ job: rawJob(), status: 'mystery' }, 'email', context).status).toBe(
      'unknown'
    )
  })
})

describe('counts', () => {
  it('keeps numeric counts of known statuses only', () => {
    expect(
      pickCounts({ waiting: 1, active: 'x', completed: Number.NaN, failed: 3, other: 5 })
    ).toEqual({
      waiting: 1,
      failed: 3,
    })
    expect(pickCounts(null)).toEqual({})
    expect(BOARD_STATUSES).toContain('waiting-children')
  })
})
