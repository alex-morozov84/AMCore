import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { SchedulerRegistry } from '@nestjs/schedule'
import request from 'supertest'

import type { AiRunSseEvent } from '@amcore/shared'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { AiRunRealtimePublisher } from '../src/core/ai/realtime/ai-run-realtime.publisher'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AiRunDispatchProcessor } from '../src/infrastructure/ai/runs/ai-run-dispatch.processor'
import { AiRunDispatchService } from '../src/infrastructure/ai/runs/ai-run-dispatch.service'
import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  type E2ETestContext,
  setupE2ETest,
  startWebAppContext,
  teardownE2ETest,
} from './helpers'
import { SseClient } from './sse-client'

/**
 * Arc C merge gate (Track C — ADR-054, ADR-053 status-only SSE). Two independent app contexts share
 * one Testcontainers Redis + Postgres: context A (all-role) creates + executes runs and publishes
 * content-free status hints; context B (web-role) serves the SSE stream on a real socket. A hint
 * published on A must reach the run owner's stream on B — proving worker executor → publish → Redis
 * bus → dedicated subscriber → process-local hub → stream, across processes, with no sticky
 * sessions. A's recovery cron is stopped and its wake consumer closed so runs execute only when a
 * test drives the dispatcher, keeping the at-most-once hint after the subscription is established.
 */
async function registerUser(app: INestApplication): Promise<{ userId: string; token: string }> {
  const email = `ai-rt-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'StrongP@ss123' })
    .expect(201)
  return { userId: res.body.user.id as string, token: res.body.accessToken as string }
}

describe('AI run realtime SSE (e2e)', () => {
  let context: E2ETestContext // context A: all-role, creates + executes + publishes
  let appA: INestApplication
  let prisma: PrismaService
  let producer: AiRunProducerService
  let dispatch: AiRunDispatchService
  let publisher: AiRunRealtimePublisher
  let contextB: { app: NestExpressApplication; baseUrl: string } // web-role, serves SSE
  const open: SseClient<AiRunSseEvent>[] = []

  const streamUrl = (runId: string): string => `${contextB.baseUrl}/ai/runs/${runId}/stream`

  const connect = async (runId: string, token: string): Promise<SseClient<AiRunSseEvent>> => {
    const client = await SseClient.open<AiRunSseEvent>(streamUrl(runId), {
      Authorization: `Bearer ${token}`,
    })
    open.push(client)
    return client
  }

  async function queueRun(userId: string, text = 'hello'): Promise<string> {
    const conv = await prisma.aiConversation.create({
      data: { ownerUserId: userId },
      select: { id: true },
    })
    const run = await producer.create(userId, {
      conversationId: conv.id,
      inputParts: [{ type: 'text', text }],
    })
    return run.id
  }

  beforeAll(async () => {
    context = await setupE2ETest()
    appA = context.app
    prisma = context.prisma
    producer = appA.get(AiRunProducerService, { strict: false })
    dispatch = appA.get(AiRunDispatchService, { strict: false })
    publisher = appA.get(AiRunRealtimePublisher, { strict: false })
    const scheduler = appA.get(SchedulerRegistry, { strict: false })
    for (const job of scheduler.getCronJobs().values()) job.stop()
    await appA.get(AiRunDispatchProcessor, { strict: false }).worker.close()
    contextB = await startWebAppContext()
  }, 120000)

  afterAll(async () => {
    for (const client of open) client.close()
    await contextB?.app.close()
    await teardownE2ETest(context)
  }, 120000)

  afterEach(async () => {
    for (const client of open.splice(0)) client.close()
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    await seedAiCatalog(prisma)
  })

  it('requires a bearer token (401 without an Authorization header)', async () => {
    const res = await fetch(streamUrl('any-run-id'))
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  it('rejects a valid JWT supplied only in the query string (no URL tokens)', async () => {
    const { token } = await registerUser(appA)
    const runId = await queueRun((await registerUser(appA)).userId) // any real run id
    const res = await fetch(`${streamUrl(runId)}?access_token=${token}`)
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  it('returns 404 for a run the caller does not own (existence never leaks)', async () => {
    const owner = await registerUser(appA)
    const other = await registerUser(appA)
    const runId = await queueRun(owner.userId)

    const res = await fetch(streamUrl(runId), {
      headers: { Authorization: `Bearer ${other.token}` },
    })
    expect(res.status).toBe(404)
    await res.body?.cancel()
  })

  it('opens the owner stream with the exact streaming headers and no proxy buffering', async () => {
    const user = await registerUser(appA)
    const runId = await queueRun(user.userId)
    const client = await connect(runId, user.token)
    expect(client.response.status).toBe(200)
    expect(client.response.headers.get('content-type')).toContain('text/event-stream')
    expect(client.response.headers.get('cache-control')).toBe('no-cache, no-transform')
    expect(client.response.headers.get('connection')).toBe('keep-alive')
    expect(client.response.headers.get('x-accel-buffering')).toBe('no')
  })

  it('delivers a worker-executed COMPLETED hint on A to the run owner stream on B', async () => {
    const user = await registerUser(appA)
    const runId = await queueRun(user.userId, 'hello')
    const client = await connect(runId, user.token)
    expect(client.response.status).toBe(200)

    // Execute only after the stream is established, so the at-most-once hint cannot precede it.
    await dispatch.drainDueBatches()

    expect(await client.next()).toMatchObject({
      runId,
      status: 'completed',
      reason: 'status_changed',
    })
  })

  it('delivers a worker-equivalent direct publish to the owner stream (content-free)', async () => {
    const user = await registerUser(appA)
    const runId = await queueRun(user.userId)
    const client = await connect(runId, user.token)
    expect(client.response.status).toBe(200)

    await publisher.publish(user.userId, runId, 'running', 'status_changed')

    expect(await client.next()).toMatchObject({
      runId,
      status: 'running',
      reason: 'status_changed',
    })
  })

  it('isolates runs: a stream receives only its own run hints', async () => {
    const userU = await registerUser(appA)
    const userV = await registerUser(appA)
    const runU = await queueRun(userU.userId)
    const runV = await queueRun(userV.userId)
    const clientU = await connect(runU, userU.token)
    const clientV = await connect(runV, userV.token)

    await publisher.publish(userU.userId, runU, 'completed', 'status_changed')
    await publisher.publish(userV.userId, runV, 'failed', 'status_changed')

    const [eventU, eventV] = await Promise.all([clientU.next(), clientV.next()])
    expect(eventU).toMatchObject({ runId: runU, status: 'completed' })
    expect(eventV).toMatchObject({ runId: runV, status: 'failed' })
  })
})
