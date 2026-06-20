import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'

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
import { SseClient } from './sse-client'

/**
 * Arc C merge gate (ADR-053). Two independent web app contexts share one
 * Testcontainers Redis + Postgres: context A (all-role) commits notifications and
 * publishes hints; context B (web-role) listens on a real socket and serves the SSE
 * stream. A hint published on A must reach the recipient's stream on B — proving
 * producer → publish → Redis bus → dedicated subscriber → process-local hub → stream
 * across processes, with no sticky sessions.
 */

async function registerUser(app: INestApplication): Promise<{ userId: string; token: string }> {
  const email = `rt-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'StrongP@ss123' })
    .expect(201)
  return { userId: res.body.user.id as string, token: res.body.accessToken as string }
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

  const connect = async (token: string): Promise<SseClient> => {
    const client = await SseClient.open(streamUrl, { Authorization: `Bearer ${token}` })
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

  it('requires a bearer token (401 without an Authorization header)', async () => {
    const res = await fetch(streamUrl)
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  it('rejects a valid JWT supplied only in the query string (no URL tokens)', async () => {
    const { token } = await registerUser(appA)
    // Real, currently-valid token — but in the query, not the Authorization header.
    const res = await fetch(`${streamUrl}?access_token=${token}`)
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  it('opens with the exact streaming headers and no proxy buffering', async () => {
    const { token } = await registerUser(appA)
    const client = await connect(token)
    expect(client.response.status).toBe(200)
    expect(client.response.headers.get('content-type')).toContain('text/event-stream')
    expect(client.response.headers.get('cache-control')).toBe('no-cache, no-transform')
    expect(client.response.headers.get('connection')).toBe('keep-alive')
    expect(client.response.headers.get('x-accel-buffering')).toBe('no')
  })

  it('delivers a real notify() committed on A to the user stream on B', async () => {
    const user = await registerUser(appA)
    const client = await connect(user.token)
    expect(client.response.status).toBe(200)

    // Publish only after the stream is established (registration completes when the
    // headers flush), so the at-most-once hint cannot precede the subscription.
    const { notificationId } = await notifications.notify({
      recipientUserId: user.userId,
      type: 'account.profile_updated',
      payload: { updatedFields: ['name'] },
      idempotencyKey: `account.profile_updated:rt-${Date.now()}`,
    })

    expect(await client.next()).toMatchObject({ reason: 'created', notificationId })
  })

  it('delivers a worker-equivalent direct publish to the user stream', async () => {
    const user = await registerUser(appA)
    const client = await connect(user.token)
    expect(client.response.status).toBe(200)

    publisher.publish(user.userId, 'read', 'direct-publish-1')

    expect(await client.next()).toMatchObject({
      reason: 'read',
      notificationId: 'direct-publish-1',
    })
  })

  it('isolates users: each stream receives only its own recipient hints', async () => {
    const userU = await registerUser(appA)
    const userV = await registerUser(appA)
    const clientU = await connect(userU.token)
    const clientV = await connect(userV.token)

    publisher.publish(userU.userId, 'archived', 'for-u')
    publisher.publish(userV.userId, 'unread_changed', 'for-v')

    const [eventU, eventV] = await Promise.all([clientU.next(), clientV.next()])
    expect(eventU).toMatchObject({ reason: 'archived', notificationId: 'for-u' })
    expect(eventV).toMatchObject({ reason: 'unread_changed', notificationId: 'for-v' })
  })
})
