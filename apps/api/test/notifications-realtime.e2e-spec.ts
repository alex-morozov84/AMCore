import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'

import type { NotificationSseEvent } from '@amcore/shared'

import { NotificationsService } from '../src/core/notifications/notifications.service'
import { NotificationRealtimePublisher } from '../src/core/notifications/realtime/notification-realtime.publisher'
import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  type E2ETestContext,
  setupE2ETest,
  startWebAppContext,
  teardownE2ETest,
} from './helpers'

/**
 * Arc C merge gate (ADR-053). Two independent web app contexts share one
 * Testcontainers Redis + Postgres: context A (all-role) commits notifications and
 * publishes hints; context B (web-role) listens on a real socket and serves the SSE
 * stream. A hint published on A must reach the recipient's stream on B — proving
 * producer → publish → Redis bus → dedicated subscriber → process-local hub → stream
 * across processes, with no sticky sessions. Real sockets + a fetch-stream reader are
 * mandatory: supertest's in-memory agent does not deliver incremental SSE chunks.
 */

/** Minimal fetch-based SSE reader: parses `data:` frames, skips `:` comments. */
class SseClient {
  private readonly events: NotificationSseEvent[] = []
  private readonly waiters: Array<{
    resolve: (e: NotificationSseEvent) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []
  private buffer = ''
  private closed = false

  private constructor(
    private readonly controller: AbortController,
    readonly response: Response
  ) {}

  static async open(url: string, headers: Record<string, string>): Promise<SseClient> {
    const controller = new AbortController()
    const response = await fetch(url, { headers, signal: controller.signal })
    const client = new SseClient(controller, response)
    if (response.body) void client.pump(response.body.getReader())
    return client
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        this.buffer += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
          const frame = this.buffer.slice(0, idx)
          this.buffer = this.buffer.slice(idx + 2)
          this.handleFrame(frame)
        }
      }
    } catch {
      /* aborted on close() — expected */
    }
  }

  private handleFrame(frame: string): void {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('')
    if (data.length === 0) return // a `:` heartbeat/ready comment frame
    const event = JSON.parse(data) as NotificationSseEvent
    const waiter = this.waiters.shift()
    if (waiter) {
      clearTimeout(waiter.timer)
      waiter.resolve(event)
    } else {
      this.events.push(event)
    }
  }

  /** Resolve the next data event, or reject after `timeoutMs` (no silent waiting). */
  next(timeoutMs = 5000): Promise<NotificationSseEvent> {
    const buffered = this.events.shift()
    if (buffered) return Promise.resolve(buffered)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.timer === timer)
        if (i !== -1) this.waiters.splice(i, 1)
        reject(new Error('SSE next() timed out'))
      }, timeoutMs)
      this.waiters.push({ resolve, reject, timer })
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.controller.abort()
    for (const w of this.waiters) {
      clearTimeout(w.timer)
      w.reject(new Error('SSE client closed'))
    }
    this.waiters.length = 0
  }
}

async function registerUser(app: INestApplication): Promise<{ userId: string; bearer: string }> {
  const email = `rt-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'StrongP@ss123' })
    .expect(201)
  return { userId: res.body.user.id as string, bearer: `Bearer ${res.body.accessToken as string}` }
}

describe('Notifications realtime SSE (e2e)', () => {
  let context: E2ETestContext // context A: all-role, produces + publishes
  let appA: INestApplication
  let prisma: PrismaService
  let notifications: NotificationsService
  let publisher: NotificationRealtimePublisher
  let contextB: { app: NestExpressApplication; baseUrl: string } // web-role, serves SSE
  let streamUrl: string
  const open: SseClient[] = []

  const connect = async (bearer: string): Promise<SseClient> => {
    const client = await SseClient.open(streamUrl, { Authorization: bearer })
    open.push(client)
    return client
  }

  beforeAll(async () => {
    context = await setupE2ETest()
    appA = context.app
    prisma = context.prisma
    notifications = appA.get(NotificationsService, { strict: false })
    publisher = appA.get(NotificationRealtimePublisher, { strict: false })
    contextB = await startWebAppContext()
    streamUrl = `${contextB.baseUrl}/notifications/stream`
  }, 120000)

  afterAll(async () => {
    for (const client of open) client.close()
    await contextB?.app.close()
    await teardownE2ETest(context)
  }, 120000)

  afterEach(async () => {
    for (const client of open.splice(0)) client.close()
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })

  it('requires a bearer token (401, no token in the query string)', async () => {
    const anon = await fetch(streamUrl)
    expect(anon.status).toBe(401)
    await anon.body?.cancel()

    const fakeUserId = '00000000-0000-0000-0000-000000000000'
    const queryToken = await fetch(`${streamUrl}?access_token=whatever`)
    expect(queryToken.status).toBe(401)
    await queryToken.body?.cancel()
    expect(fakeUserId).toBeDefined()
  })

  it('opens with streaming headers and no proxy buffering', async () => {
    const user = await registerUser(appA)
    const client = await connect(user.bearer)
    expect(client.response.status).toBe(200)
    expect(client.response.headers.get('content-type')).toContain('text/event-stream')
    expect(client.response.headers.get('cache-control')).toBe('no-cache, no-transform')
    expect(client.response.headers.get('x-accel-buffering')).toBe('no')
  })

  it('delivers a real notify() committed on A to the user stream on B', async () => {
    const user = await registerUser(appA)
    const client = await connect(user.bearer)
    expect(client.response.status).toBe(200)

    // Publish only after the stream is established (registration completes when the
    // headers flush), so the at-most-once hint cannot precede the subscription.
    const { notificationId } = await notifications.notify({
      recipientUserId: user.userId,
      type: 'account.profile_updated',
      payload: { updatedFields: ['name'] },
      idempotencyKey: `account.profile_updated:rt-${Date.now()}`,
    })

    const event = await client.next()
    expect(event.reason).toBe('created')
    expect(event.notificationId).toBe(notificationId)
  })

  it('delivers a worker-equivalent direct publish to the user stream', async () => {
    const user = await registerUser(appA)
    const client = await connect(user.bearer)
    expect(client.response.status).toBe(200)

    const notificationId = 'direct-publish-1'
    publisher.publish(user.userId, 'read', notificationId)

    const event = await client.next()
    expect(event.reason).toBe('read')
    expect(event.notificationId).toBe(notificationId)
  })

  it('isolates users: each stream receives only its own recipient hints', async () => {
    const userU = await registerUser(appA)
    const userV = await registerUser(appA)
    const clientU = await connect(userU.bearer)
    const clientV = await connect(userV.bearer)

    publisher.publish(userU.userId, 'archived', 'for-u')
    publisher.publish(userV.userId, 'unread_changed', 'for-v')

    const [eventU, eventV] = await Promise.all([clientU.next(), clientV.next()])
    expect(eventU).toMatchObject({ reason: 'archived', notificationId: 'for-u' })
    expect(eventV).toMatchObject({ reason: 'unread_changed', notificationId: 'for-v' })
  })
})
