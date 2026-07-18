import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { TokenManagerService } from '../src/core/auth/token-manager.service'
import {
  NotificationCategory,
  NotificationChannel,
} from '../src/core/notifications/notification.constants'
import { NotificationIdempotencyConflictError } from '../src/core/notifications/notification.errors'
import { NotificationRetentionService } from '../src/core/notifications/notification-retention.service'
import { NotificationsService } from '../src/core/notifications/notifications.service'
import type { PrismaService } from '../src/prisma'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

import { NotificationAttemptOutcome, NotificationDeliveryStatus } from '@/generated/prisma/client'

interface RegisteredUser {
  userId: string
  authHeader: string
  email: string
}

let emailCounter = 0
function uniqueEmail(): string {
  emailCounter += 1
  return `notif-${Date.now()}-${emailCounter}@example.com`
}

let idempotencyCounter = 0
function uniqueIdempotencyKey(prefix = 'occ'): string {
  idempotencyCounter += 1
  return `account.profile_updated:${prefix}-${Date.now()}-${idempotencyCounter}`
}

async function registerUser(
  app: INestApplication,
  opts: { locale?: 'ru' | 'en' } = {}
): Promise<RegisteredUser> {
  const email = uniqueEmail()
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      email,
      password: 'StrongP@ss123',
      ...(opts.locale ? { locale: opts.locale } : {}),
    })
    .expect(201)
  const userId = res.body.user.id as string
  const accessToken = res.body.accessToken as string
  return { userId, authHeader: `Bearer ${accessToken}`, email }
}

/**
 * Arc A.7 — Testcontainers e2e merge gate for the notifications feed + preferences
 * HTTP surface and the producer's transactional/idempotency guarantees.
 *
 * Out of scope (Arc B dispatcher internals): lease/retry/SKIP-LOCKED claim proofs and
 * the email send delivery state machine (those are the B.7 Testcontainers gate); SSE;
 * full process-role boundary checks (process-role.e2e-spec.ts). The mandatory-channel
 * preference rejection and the first external (email) delivery materialization are
 * covered below via the `account.password_changed` security definition (B.5).
 */
describe('Notifications (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let notifications: NotificationsService
  let tokenManager: TokenManagerService
  let retention: NotificationRetentionService

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    notifications = app.get(NotificationsService, { strict: false })
    tokenManager = app.get(TokenManagerService, { strict: false })
    retention = app.get(NotificationRetentionService, { strict: false })
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })

  /**
   * Seed a notification via the real producer (not raw SQL) so the in-app delivery
   * row is materialized too — this exercises the same path the public-facing flow
   * will use in Arc B.
   */
  async function seed(
    userId: string,
    opts: { idempotencyKey?: string; updatedFields?: Array<'name' | 'email' | 'locale'> } = {}
  ): Promise<{ notificationId: string }> {
    const result = await notifications.notify({
      recipientUserId: userId,
      type: 'account.profile_updated',
      payload: { updatedFields: opts.updatedFields ?? ['name'] },
      idempotencyKey: opts.idempotencyKey ?? uniqueIdempotencyKey(),
    })
    return { notificationId: result.notificationId }
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 3))

  describe('GET /notifications', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/notifications').expect(401)
    })

    it('returns an empty feed when no notifications exist', async () => {
      const user = await registerUser(app)
      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(res.body).toEqual({ data: [], nextCursor: null, hasMore: false })
    })

    it('returns server-rendered items in DESC order, scoped to the caller', async () => {
      const user = await registerUser(app, { locale: 'en' })
      const foreign = await registerUser(app)
      await seed(user.userId, { updatedFields: ['name'] })
      await settle()
      await seed(user.userId, { updatedFields: ['name', 'email'] })
      await seed(foreign.userId)

      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', user.authHeader)
        .expect(200)

      expect(res.body.data).toHaveLength(2)
      expect(res.body.hasMore).toBe(false)
      expect(res.body.nextCursor).toBeNull()
      // Most recent first; locale=en → English render.
      expect(res.body.data[0]).toMatchObject({
        type: 'account.profile_updated',
        category: NotificationCategory.ACCOUNT,
        title: 'Profile updated',
        body: 'You updated 2 profile field(s).',
        readAt: null,
        archivedAt: null,
      })
      expect(res.body.data[1]).toMatchObject({
        title: 'Profile updated',
        body: 'You updated 1 profile field(s).',
      })
    })

    it('omits archived notifications', async () => {
      const user = await registerUser(app)
      const { notificationId } = await seed(user.userId)
      await prisma.notification.update({
        where: { id: notificationId },
        data: { archivedAt: new Date() },
      })

      const res = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(res.body.data).toEqual([])
    })

    it('rejects an invalid cursor with 400', async () => {
      const user = await registerUser(app)
      await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', user.authHeader)
        .query({ cursor: 'not-a-real-cursor' })
        .expect(400)
    })

    it('paginates by cursor without duplicates or skips under concurrent insert', async () => {
      const user = await registerUser(app)
      const initialIds: string[] = []
      for (let i = 0; i < 5; i += 1) {
        const { notificationId } = await seed(user.userId)
        initialIds.push(notificationId)
        await settle()
      }

      const page1 = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', user.authHeader)
        .query({ limit: 2 })
        .expect(200)
      expect(page1.body.data).toHaveLength(2)
      expect(page1.body.hasMore).toBe(true)
      expect(page1.body.nextCursor).toBeTruthy()

      // Concurrent insert AFTER the cursor — must not appear on a later page that
      // pages back through older rows (cursor predicate is strict-less-than).
      const concurrent = await seed(user.userId)

      const page2 = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', user.authHeader)
        .query({ limit: 2, cursor: page1.body.nextCursor })
        .expect(200)
      expect(page2.body.data).toHaveLength(2)
      expect(page2.body.hasMore).toBe(true)

      const page3 = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', user.authHeader)
        .query({ limit: 2, cursor: page2.body.nextCursor })
        .expect(200)
      expect(page3.body.data).toHaveLength(1)
      expect(page3.body.hasMore).toBe(false)
      expect(page3.body.nextCursor).toBeNull()

      const seenIds: string[] = [...page1.body.data, ...page2.body.data, ...page3.body.data].map(
        (item: { id: string }) => item.id
      )

      expect(new Set(seenIds).size).toBe(seenIds.length)
      expect(seenIds.sort()).toEqual([...initialIds].sort())
      expect(seenIds).not.toContain(concurrent.notificationId)
    })
  })

  describe('GET /notifications/unread-count', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/notifications/unread-count').expect(401)
    })

    it('counts only unread, non-archived, recipient-scoped rows', async () => {
      const user = await registerUser(app)
      const foreign = await registerUser(app)
      const read = await seed(user.userId)
      const archived = await seed(user.userId)
      await seed(user.userId)
      await seed(foreign.userId)
      await prisma.notification.update({
        where: { id: read.notificationId },
        data: { readAt: new Date() },
      })
      await prisma.notification.update({
        where: { id: archived.notificationId },
        data: { archivedAt: new Date() },
      })

      const res = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(res.body).toEqual({ unread: 1 })
    })
  })

  describe('POST /notifications/:id/read', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).post('/notifications/any-id/read').expect(401)
    })

    it('marks one notification read (204), is idempotent, and is recipient-scoped', async () => {
      const user = await registerUser(app)
      const foreign = await registerUser(app)
      const { notificationId } = await seed(user.userId)

      await request(app.getHttpServer())
        .post(`/notifications/${notificationId}/read`)
        .set('Authorization', user.authHeader)
        .expect(204)

      const afterFirst = await prisma.notification.findUniqueOrThrow({
        where: { id: notificationId },
      })
      expect(afterFirst.readAt).toBeInstanceOf(Date)
      const firstReadAt = afterFirst.readAt!.getTime()

      // Idempotent: second call still 204; readAt is not re-stamped.
      await settle()
      await request(app.getHttpServer())
        .post(`/notifications/${notificationId}/read`)
        .set('Authorization', user.authHeader)
        .expect(204)
      const afterSecond = await prisma.notification.findUniqueOrThrow({
        where: { id: notificationId },
      })
      expect(afterSecond.readAt!.getTime()).toBe(firstReadAt)

      // Foreign user cannot flip readAt on someone else's row.
      const other = await seed(user.userId)
      await request(app.getHttpServer())
        .post(`/notifications/${other.notificationId}/read`)
        .set('Authorization', foreign.authHeader)
        .expect(204)
      const stillUnread = await prisma.notification.findUniqueOrThrow({
        where: { id: other.notificationId },
      })
      expect(stillUnread.readAt).toBeNull()
    })

    it('is a 204 no-op for a non-existent id', async () => {
      const user = await registerUser(app)
      await request(app.getHttpServer())
        .post('/notifications/no-such-id/read')
        .set('Authorization', user.authHeader)
        .expect(204)
    })
  })

  describe('POST /notifications/read-all', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).post('/notifications/read-all').expect(401)
    })

    it('returns the number marked read and ignores foreign + archived rows', async () => {
      const user = await registerUser(app)
      const foreign = await registerUser(app)
      await seed(user.userId)
      await seed(user.userId)
      const archived = await seed(user.userId)
      await prisma.notification.update({
        where: { id: archived.notificationId },
        data: { archivedAt: new Date() },
      })
      await seed(foreign.userId)

      const res = await request(app.getHttpServer())
        .post('/notifications/read-all')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(res.body).toEqual({ updated: 2 })

      const foreignRows = await prisma.notification.findMany({
        where: { recipientUserId: foreign.userId },
      })
      expect(foreignRows.every((row) => row.readAt === null)).toBe(true)

      const archivedRow = await prisma.notification.findUniqueOrThrow({
        where: { id: archived.notificationId },
      })
      expect(archivedRow.readAt).toBeNull()
    })
  })

  describe('POST /notifications/:id/archive', () => {
    it('archives (204), is idempotent, and removes the row from feed + unread count', async () => {
      const user = await registerUser(app)
      const { notificationId } = await seed(user.userId)

      await request(app.getHttpServer())
        .post(`/notifications/${notificationId}/archive`)
        .set('Authorization', user.authHeader)
        .expect(204)

      const afterFirst = await prisma.notification.findUniqueOrThrow({
        where: { id: notificationId },
      })
      expect(afterFirst.archivedAt).toBeInstanceOf(Date)
      const firstArchivedAt = afterFirst.archivedAt!.getTime()

      await settle()
      await request(app.getHttpServer())
        .post(`/notifications/${notificationId}/archive`)
        .set('Authorization', user.authHeader)
        .expect(204)
      const afterSecond = await prisma.notification.findUniqueOrThrow({
        where: { id: notificationId },
      })
      expect(afterSecond.archivedAt!.getTime()).toBe(firstArchivedAt)

      const feed = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(feed.body.data).toEqual([])

      const count = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(count.body).toEqual({ unread: 0 })
    })
  })

  describe('GET /notifications/capabilities', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/notifications/capabilities').expect(401)
    })

    it('returns the active starter capabilities (incl. Telegram; security in-app+email mandatory)', async () => {
      const user = await registerUser(app)
      const res = await request(app.getHttpServer())
        .get('/notifications/capabilities')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(res.body).toEqual({
        channels: [
          NotificationChannel.EMAIL,
          NotificationChannel.IN_APP,
          NotificationChannel.TELEGRAM,
        ],
        categories: [
          {
            // account.profile_updated (in_app) + account.telegram_linked (in_app, telegram).
            category: NotificationCategory.ACCOUNT,
            channels: [NotificationChannel.IN_APP, NotificationChannel.TELEGRAM],
            overridableChannels: [NotificationChannel.IN_APP, NotificationChannel.TELEGRAM],
          },
          {
            // account.password_changed: in_app+email mandatory; telegram optional (Arc D).
            category: NotificationCategory.SECURITY,
            channels: [
              NotificationChannel.EMAIL,
              NotificationChannel.IN_APP,
              NotificationChannel.TELEGRAM,
            ],
            overridableChannels: [NotificationChannel.TELEGRAM],
          },
        ],
      })
    })
  })

  describe('GET /notifications/preferences', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/notifications/preferences').expect(401)
    })

    it('returns the master toggle (default true) and per-(category, channel) rows', async () => {
      const user = await registerUser(app)
      const res = await request(app.getHttpServer())
        .get('/notifications/preferences')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(res.body.notificationsEnabled).toBe(true)
      expect(res.body.preferences).toEqual([
        {
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.IN_APP,
          enabled: null,
          mandatory: false,
        },
        {
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.TELEGRAM,
          enabled: null,
          mandatory: false,
        },
        // account.password_changed — in_app + email mandatory (a security alert)…
        {
          category: NotificationCategory.SECURITY,
          channel: NotificationChannel.EMAIL,
          enabled: null,
          mandatory: true,
        },
        {
          category: NotificationCategory.SECURITY,
          channel: NotificationChannel.IN_APP,
          enabled: null,
          mandatory: true,
        },
        // …with Telegram an optional (non-mandatory) default (Arc D).
        {
          category: NotificationCategory.SECURITY,
          channel: NotificationChannel.TELEGRAM,
          enabled: null,
          mandatory: false,
        },
      ])
    })
  })

  describe('PUT /notifications/preferences', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .put('/notifications/preferences')
        .send({
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.IN_APP,
          enabled: false,
        })
        .expect(401)
    })

    it('upserts the stored override (204); subsequent GET reflects it', async () => {
      const user = await registerUser(app)

      await request(app.getHttpServer())
        .put('/notifications/preferences')
        .set('Authorization', user.authHeader)
        .send({
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.IN_APP,
          enabled: false,
        })
        .expect(204)

      const afterFalse = await request(app.getHttpServer())
        .get('/notifications/preferences')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(afterFalse.body.preferences[0]).toMatchObject({ enabled: false, mandatory: false })

      // Upsert flips the same row, not a duplicate.
      await request(app.getHttpServer())
        .put('/notifications/preferences')
        .set('Authorization', user.authHeader)
        .send({
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.IN_APP,
          enabled: true,
        })
        .expect(204)

      const afterTrue = await request(app.getHttpServer())
        .get('/notifications/preferences')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(afterTrue.body.preferences[0]).toMatchObject({ enabled: true })

      const stored = await prisma.notificationPreference.findMany({
        where: { userId: user.userId },
      })
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({
        category: NotificationCategory.ACCOUNT,
        channel: NotificationChannel.IN_APP,
        enabled: true,
      })
    })

    it('rejects an unknown (category, channel) combination with 400', async () => {
      const user = await registerUser(app)
      // ACCOUNT supports only in-app (account.profile_updated), so account+email is unknown.
      await request(app.getHttpServer())
        .put('/notifications/preferences')
        .set('Authorization', user.authHeader)
        .send({
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.EMAIL,
          enabled: false,
        })
        .expect(400)
    })

    it('rejects disabling a mandatory security channel with 400', async () => {
      const user = await registerUser(app)
      // account.password_changed makes both security channels mandatory — neither the
      // email nor the in-app delivery of a password-change alert can be silenced.
      for (const channel of [NotificationChannel.EMAIL, NotificationChannel.IN_APP]) {
        await request(app.getHttpServer())
          .put('/notifications/preferences')
          .set('Authorization', user.authHeader)
          .send({ category: NotificationCategory.SECURITY, channel, enabled: false })
          .expect(400)
      }
    })

    it('rejects a malformed body with 400', async () => {
      const user = await registerUser(app)
      await request(app.getHttpServer())
        .put('/notifications/preferences')
        .set('Authorization', user.authHeader)
        .send({
          category: NotificationCategory.ACCOUNT,
          channel: NotificationChannel.IN_APP,
        })
        .expect(400)
    })
  })

  describe('PATCH /notifications/settings', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .patch('/notifications/settings')
        .send({ notificationsEnabled: false })
        .expect(401)
    })

    it('updates the master toggle (204); GET preferences reflects it', async () => {
      const user = await registerUser(app)
      await request(app.getHttpServer())
        .patch('/notifications/settings')
        .set('Authorization', user.authHeader)
        .send({ notificationsEnabled: false })
        .expect(204)

      const off = await request(app.getHttpServer())
        .get('/notifications/preferences')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(off.body.notificationsEnabled).toBe(false)

      await request(app.getHttpServer())
        .patch('/notifications/settings')
        .set('Authorization', user.authHeader)
        .send({ notificationsEnabled: true })
        .expect(204)
      const on = await request(app.getHttpServer())
        .get('/notifications/preferences')
        .set('Authorization', user.authHeader)
        .expect(200)
      expect(on.body.notificationsEnabled).toBe(true)
    })
  })

  describe('Producer atomicity and idempotency', () => {
    it('rolls back a notifyTx write when the caller transaction throws', async () => {
      const user = await registerUser(app)
      const idempotencyKey = uniqueIdempotencyKey('rollback')

      await expect(
        prisma.$transaction(async (tx) => {
          await notifications.notifyTx(tx, {
            recipientUserId: user.userId,
            type: 'account.profile_updated',
            payload: { updatedFields: ['name'] },
            idempotencyKey,
          })
          throw new Error('caller-aborted')
        })
      ).rejects.toThrow('caller-aborted')

      const notification = await prisma.notification.findFirst({
        where: { recipientUserId: user.userId, idempotencyKey },
      })
      expect(notification).toBeNull()

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notification: { idempotencyKey } },
      })
      expect(deliveries).toEqual([])
    })

    it('treats a same-key, same-fingerprint replay as the existing row', async () => {
      const user = await registerUser(app)
      const idempotencyKey = uniqueIdempotencyKey('replay')

      const first = await notifications.notify({
        recipientUserId: user.userId,
        type: 'account.profile_updated',
        payload: { updatedFields: ['name'] },
        idempotencyKey,
      })
      expect(first.created).toBe(true)
      expect(first.channels).toEqual([NotificationChannel.IN_APP])

      const second = await notifications.notify({
        recipientUserId: user.userId,
        type: 'account.profile_updated',
        payload: { updatedFields: ['name'] },
        idempotencyKey,
      })
      expect(second.created).toBe(false)
      expect(second.notificationId).toBe(first.notificationId)
      expect(second.channels).toEqual([NotificationChannel.IN_APP])

      const rows = await prisma.notification.findMany({
        where: { recipientUserId: user.userId, idempotencyKey },
      })
      expect(rows).toHaveLength(1)

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId: first.notificationId },
      })
      expect(deliveries).toHaveLength(1)
    })

    it('rejects a same-key, different-fingerprint reuse', async () => {
      const user = await registerUser(app)
      const idempotencyKey = uniqueIdempotencyKey('mismatch')

      await notifications.notify({
        recipientUserId: user.userId,
        type: 'account.profile_updated',
        payload: { updatedFields: ['name'] },
        idempotencyKey,
      })

      await expect(
        notifications.notify({
          recipientUserId: user.userId,
          type: 'account.profile_updated',
          payload: { updatedFields: ['email'] },
          idempotencyKey,
        })
      ).rejects.toBeInstanceOf(NotificationIdempotencyConflictError)
    })
  })

  describe('account.password_changed (password reset → security alert)', () => {
    it('promotes emailVerified and materializes in-app + email deliveries', async () => {
      const user = await registerUser(app)
      // A freshly registered account is unverified — the verified-only email resolver
      // would otherwise SKIP its email delivery.
      const before = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })
      expect(before.emailVerified).toBe(false)

      // Mint a real reset token (the raw token is normally emailed) and drive the
      // public reset endpoint.
      const { token } = await tokenManager.generatePasswordResetToken(user.userId)
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, password: 'BrandNewP@ss1' })
        .expect(204)

      // The consumed reset token proves mailbox control → emailVerified is promoted.
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } })
      expect(after.emailVerified).toBe(true)

      // The security notification was produced via the durable subsystem.
      const notification = await prisma.notification.findFirstOrThrow({
        where: { recipientUserId: user.userId, type: 'account.password_changed' },
      })
      expect(notification.category).toBe(NotificationCategory.SECURITY)

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId: notification.id },
      })
      const inApp = deliveries.find((d) => d.channel === NotificationChannel.IN_APP)
      const email = deliveries.find((d) => d.channel === NotificationChannel.EMAIL)

      // In-app is delivered synchronously; the feed never waits on the worker.
      expect(inApp?.status).toBe('DELIVERED')
      // The email delivery is materialized as real work (verified destination), NOT
      // SKIPPED as unverified — proving the in-transaction promotion. It is then drained
      // by the worker, so accept any live/terminal-success state, just not SKIPPED.
      expect(email).toBeDefined()
      expect(email?.status).not.toBe('SKIPPED')
      expect(email?.terminalReasonCode).not.toBe('destination_unverified')
    })
  })

  describe('retention (NotificationRetentionService.runRetention)', () => {
    const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

    let seq = 0
    async function makeNotification(
      userId: string,
      overrides: { createdAt?: Date; readAt?: Date | null; archivedAt?: Date | null } = {}
    ): Promise<string> {
      seq += 1
      const row = await prisma.notification.create({
        data: {
          recipientUserId: userId,
          type: 'account.profile_updated',
          category: NotificationCategory.ACCOUNT,
          schemaVersion: 1,
          payload: { updatedFields: ['name'] },
          idempotencyKey: `account.profile_updated:retention-${Date.now()}-${seq}`,
          idempotencyFingerprint: `fp-${Date.now()}-${seq}`,
          occurredAt: overrides.createdAt ?? new Date(),
          createdAt: overrides.createdAt ?? new Date(),
          readAt: overrides.readAt ?? null,
          archivedAt: overrides.archivedAt ?? null,
        },
        select: { id: true },
      })
      return row.id
    }

    it('deletes aged feed rows by state but keeps recent ones and active deliveries', async () => {
      const user = await registerUser(app)

      const staleArchived = await makeNotification(user.userId, { archivedAt: daysAgo(40) })
      const staleRead = await makeNotification(user.userId, { readAt: daysAgo(100) })
      const staleUnread = await makeNotification(user.userId, { createdAt: daysAgo(200) })
      const recentUnread = await makeNotification(user.userId, { createdAt: daysAgo(5) })
      const recentlyArchived = await makeNotification(user.userId, { archivedAt: daysAgo(5) })

      // Aged-out by every window, but it still has an active (PENDING) external delivery,
      // so the cascade must NOT remove it.
      const archivedButActive = await makeNotification(user.userId, { archivedAt: daysAgo(40) })
      await prisma.notificationDelivery.create({
        data: {
          notificationId: archivedButActive,
          channel: NotificationChannel.EMAIL,
          targetKey: user.email,
          locale: 'ru',
          status: NotificationDeliveryStatus.PENDING,
          maxAttempts: 5,
          // Not due, so the background recovery poller never claims/drains it during the
          // test — it stays a deterministically "active" PENDING row.
          availableAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      })

      const result = await retention.runRetention()

      expect(result.archivedNotifications).toBeGreaterThanOrEqual(1)
      expect(result.readNotifications).toBeGreaterThanOrEqual(1)
      expect(result.unreadNotifications).toBeGreaterThanOrEqual(1)
      expect(result.failures).toEqual([])

      const surviving = await prisma.notification.findMany({
        where: { recipientUserId: user.userId },
        select: { id: true },
      })
      const ids = surviving.map((r) => r.id)
      expect(ids).not.toContain(staleArchived)
      expect(ids).not.toContain(staleRead)
      expect(ids).not.toContain(staleUnread)
      expect(ids).toContain(recentUnread)
      expect(ids).toContain(recentlyArchived)
      // Active external work is never auto-deleted.
      expect(ids).toContain(archivedButActive)
    })

    it('prunes finished attempts older than the window but keeps in-flight/recent ones', async () => {
      const user = await registerUser(app)
      const notificationId = await makeNotification(user.userId, { createdAt: daysAgo(1) })
      const delivery = await prisma.notificationDelivery.create({
        data: {
          notificationId,
          channel: NotificationChannel.EMAIL,
          targetKey: user.email,
          locale: 'ru',
          status: NotificationDeliveryStatus.RETRY_SCHEDULED,
          maxAttempts: 5,
          // Keep it out of the due-set so the background poller does not re-attempt it
          // mid-test (we only care about its attempt-history pruning here).
          availableAt: new Date(Date.now() + 60 * 60 * 1000),
          nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        select: { id: true },
      })

      const oldAttempt = await prisma.notificationDeliveryAttempt.create({
        data: {
          deliveryId: delivery.id,
          attemptNumber: 1,
          leaseToken: 'lease-old',
          startedAt: daysAgo(40),
          finishedAt: daysAgo(40),
          outcome: NotificationAttemptOutcome.TRANSIENT_FAILURE,
        },
        select: { id: true },
      })
      const inFlightAttempt = await prisma.notificationDeliveryAttempt.create({
        data: {
          deliveryId: delivery.id,
          attemptNumber: 2,
          leaseToken: 'lease-live',
          startedAt: new Date(),
          finishedAt: null,
        },
        select: { id: true },
      })

      const result = await retention.runRetention()
      expect(result.finishedAttempts).toBeGreaterThanOrEqual(1)

      const remaining = await prisma.notificationDeliveryAttempt.findMany({
        where: { deliveryId: delivery.id },
        select: { id: true },
      })
      const ids = remaining.map((r) => r.id)
      expect(ids).not.toContain(oldAttempt.id)
      // An in-flight attempt (finishedAt null) is never pruned by age.
      expect(ids).toContain(inFlightAttempt.id)
    })
  })
})
