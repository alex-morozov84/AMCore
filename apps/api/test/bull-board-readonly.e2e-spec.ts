import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { BULL_BOARD_ADAPTER } from '@bull-board/nestjs'
import { jest } from '@jest/globals'
import type { INestApplication } from '@nestjs/common'
import { Job, Queue } from 'bullmq'
import express from 'express'
import request from 'supertest'

import type { PrismaService } from '../src/prisma'

import { BOARD, queueOf, superAdminCookie } from './bull-board.helper'
import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

/**
 * The board is read-only whatever the environment says. `BULL_BOARD_READ_ONLY=false` — the retired
 * opt-in — is set BEFORE the application is built to prove it changes nothing. Every mutating
 * route of the installed Bull Board (23, inventoried independently of the code under test) is
 * called with a valid body through the real mount, and no queue or job command may run.
 */
process.env.BULL_BOARD_READ_ONLY = 'false'

type Verb = 'put' | 'post' | 'patch'
const MUTATIONS: ReadonlyArray<readonly [Verb, string, unknown?]> = [
  ['put', '/api/queues/pause'],
  ['put', '/api/queues/resume'],
  ['post', '/api/queues/email/add', { name: 'x', data: {}, options: {} }],
  ['put', '/api/queues/email/retry/failed'],
  ['put', '/api/queues/email/promote'],
  ['put', '/api/queues/email/clean/failed'],
  ['put', '/api/queues/email/pause'],
  ['put', '/api/queues/email/resume'],
  ['put', '/api/queues/email/concurrency', { concurrency: 2 }],
  ['put', '/api/queues/email/rate-limit', { max: 1, duration: 1000 }],
  ['put', '/api/queues/email/rate-limit/release'],
  ['put', '/api/queues/email/empty'],
  ['put', '/api/queues/email/obliterate', { force: false }],
  ['put', '/api/queues/email/job-schedulers/s1/remove'],
  ['patch', '/api/queues/email/job-schedulers/s1', { every: 1000 }],
  ['put', '/api/queues/email/job-schedulers/s1/run'],
  ['put', '/api/queues/email/job-1/retry'],
  ['put', '/api/queues/email/job-1/clean'],
  ['put', '/api/queues/email/job-1/promote'],
  ['patch', '/api/queues/email/job-1/update-data', { data: { a: 1 } }],
  ['patch', '/api/queues/email/job-1/delay', { runAt: 4_102_444_800_000 }],
  ['patch', '/api/queues/email/job-1/priority', { priority: 1 }],
  ['put', '/api/queues/email/job-1/remove-unprocessed-children'],
]

// Every row gets a body: with a 2-element row jest-each would hand its `done` callback to the 3rd argument.
const CASES = MUTATIONS.map(
  ([verb, path, body]) => [verb, path, body ?? {}] as [Verb, string, object]
)

const QUEUE_COMMANDS = [
  'add',
  'pause',
  'resume',
  'drain',
  'clean',
  'obliterate',
  'promoteJobs',
  'retryJobs',
  'setGlobalConcurrency',
  'setGlobalRateLimit',
  'removeGlobalRateLimit',
  'upsertJobScheduler',
  'removeJobScheduler',
] as const
const JOB_COMMANDS = [
  'retry',
  'remove',
  'promote',
  'updateData',
  'changeDelay',
  'changePriority',
] as const

describe('Bull Board is read-only (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let cookie: string
  let spies: Array<ReturnType<typeof jest.spyOn>>

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    cookie = await superAdminCookie(app, prisma)
    spies = [
      ...QUEUE_COMMANDS.map((name) => jest.spyOn(Queue.prototype as never, name as never)),
      ...JOB_COMMANDS.map((name) => jest.spyOn(Job.prototype as never, name as never)),
    ]
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  function commandCalls(): number {
    return spies.reduce((total, spy) => total + spy.mock.calls.length, 0)
  }

  it.each(CASES)('rejects %s %s with 405 and runs no command', async (verb, path, body) => {
    const res = await request(app.getHttpServer())
      [verb](`${BOARD}${path}`)
      .set('Cookie', cookie)
      .send(body)
    expect(res.status).toBe(405)
    expect(res.headers.allow).toBe('GET, HEAD')
    expect(res.text).toBe('')
    expect(commandCalls()).toBe(0)
  })

  it('rejects other verbs and unknown writes without running any command', async () => {
    for (const [verb, path] of [
      ['delete', '/api/queues/email/job-1'],
      ['options', '/api/queues/email'],
      ['put', '/api/whatever'],
      ['post', '/api/queues/email/job-1/logs'],
      ['patch', '/queue/email'],
    ] as const) {
      const res = await request(app.getHttpServer())[verb](`${BOARD}${path}`).set('Cookie', cookie)
      expect(res.status).toBe(405)
    }
    expect(commandCalls()).toBe(0)
  })

  it('serves HEAD on an allowed route without a body', async () => {
    const res = await request(app.getHttpServer()).head(`${BOARD}/api/queues`).set('Cookie', cookie)
    expect(res.status).toBe(200)
    expect(res.text ?? '').toBe('')
  })

  it('changes no queue state', async () => {
    const queue = queueOf(app, 'email')
    for (const [verb, path, body] of CASES) {
      await request(app.getHttpServer())[verb](`${BOARD}${path}`).set('Cookie', cookie).send(body)
    }
    expect(await queue.isPaused()).toBe(false)
    expect(await queue.getGlobalConcurrency()).toBeNull()
  })

  describe('the Board router itself, without the HTTP boundary in front', () => {
    // One explicit IPv4 listener for the whole block (not a temporary one per request), closed by the
    // block. An unexpected answer reports which listener answered and the shape of the reply, with
    // no cookie, token or payload, so the cause can be found instead of retried.
    let routerServer: Server
    let routerBase: string

    beforeAll(async () => {
      const adapter = app.get(BULL_BOARD_ADAPTER, { strict: false }) as { getRouter(): never }
      routerServer = createServer(express().use(adapter.getRouter()))
      await new Promise<void>((resolve) => routerServer.listen(0, '127.0.0.1', resolve))
      routerBase = `http://127.0.0.1:${(routerServer.address() as AddressInfo).port}`
    })

    afterAll(async () => {
      await new Promise((resolve) => routerServer.close(resolve))
    })

    it.each(CASES)('denies %s %s through the Board hooks', async (verb, path, body) => {
      const res = await request(routerBase)[verb](path).send(body)
      const seen = JSON.stringify({
        listener: routerBase,
        status: res.status,
        contentType: res.headers['content-type'],
        poweredBy: res.headers['x-powered-by'],
        bodyKeys: Object.keys((res.body ?? {}) as object),
      })
      if (res.status !== 404 && res.status !== 405) {
        throw new Error(`the Board router answered ${res.status} instead of 404/405: ${seen}`)
      }
      expect(res.status === 405 ? Object.keys(res.body as object) : ['error']).toEqual(['error'])
      expect(commandCalls()).toBe(0)
    })
  })
})
