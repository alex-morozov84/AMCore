import { createHash, randomBytes } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import request from 'supertest'

import { NotificationDispatchProcessor } from '../src/core/notifications/dispatch/notification-dispatch.processor'
import { NotificationDispatchService } from '../src/core/notifications/dispatch/notification-dispatch.service'
import { NotificationsService } from '../src/core/notifications/notifications.service'
import type { PrismaService } from '../src/prisma'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'
import { type FakeTelegram, startFakeTelegram } from './telegram-fake-server'

export const TG_SECRET = 'aB0_-Zz9'
export const TG_BOT = 'amcore_test_bot'

export interface TelegramE2E {
  context: E2ETestContext
  app: INestApplication
  prisma: PrismaService
  fake: FakeTelegram
  notifications: NotificationsService
  dispatch: NotificationDispatchService
}

/** Boot the app with the Telegram channel enabled + a fake Bot API; close the async dispatch worker. */
export async function setupTelegramE2E(): Promise<TelegramE2E> {
  const fake = await startFakeTelegram()
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
  process.env.TELEGRAM_BOT_USERNAME = TG_BOT
  process.env.WEBHOOK_TELEGRAM_SECRET = TG_SECRET
  process.env.TELEGRAM_API_BASE_URL = fake.url
  const context = await setupE2ETest()
  const { app } = context
  // Only explicit `dispatch.runDispatchCycle()` calls should drain — no cron, no async worker race.
  for (const [, job] of app.get(SchedulerRegistry, { strict: false }).getCronJobs()) void job.stop()
  await app.get(NotificationDispatchProcessor, { strict: false }).worker.close(true)
  return {
    context,
    app,
    prisma: context.prisma,
    fake,
    notifications: app.get(NotificationsService, { strict: false }),
    dispatch: app.get(NotificationDispatchService, { strict: false }),
  }
}

export async function teardownTelegramE2E(tg: TelegramE2E | undefined): Promise<void> {
  if (tg?.context) await teardownE2ETest(tg.context)
  if (tg?.fake) await tg.fake.close()
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_BOT_USERNAME
  delete process.env.WEBHOOK_TELEGRAM_SECRET
  delete process.env.TELEGRAM_API_BASE_URL
}

/** Per-test reset: clean the DB + receipts and restore the default fake send response. */
export async function resetTelegramE2E(tg: TelegramE2E): Promise<void> {
  await cleanDatabase(tg.prisma, tg.context.cache, tg.context.throttlerStorage)
  await tg.prisma.telegramUpdateReceipt.deleteMany()
  tg.fake.setSendResponse(200, { ok: true, result: { message_id: 1 } })
  tg.fake.sendCalls.length = 0
}

const tgHash = (raw: string): string => createHash('sha256').update(raw).digest('hex')

/** A private-chat `/start <token>` update (from.id == chat.id, as a private chat requires). */
export function startUpdate(updateId: number, chatId: number, token: string): object {
  return {
    update_id: updateId,
    message: {
      text: `/start ${token}`,
      chat: { id: chatId, type: 'private' },
      from: { id: chatId },
    },
  }
}

let userSeq = 0

/** Create a verified user directly (no auth) — for webhook/delivery scenarios. */
export async function createTgUser(prisma: PrismaService): Promise<string> {
  userSeq += 1
  const email = `tg-${Date.now()}-${userSeq}@example.com`
  const user = await prisma.user.create({
    data: { email, emailCanonical: email, emailVerified: true },
    select: { id: true },
  })
  return user.id
}

/** Insert a fresh one-time link token row directly; returns the raw token. */
export async function issueTokenRow(prisma: PrismaService, userId: string): Promise<string> {
  const raw = randomBytes(32).toString('base64url')
  await prisma.telegramLinkToken.create({
    data: { userId, tokenHash: tgHash(raw), expiresAt: new Date(Date.now() + 600_000) },
  })
  return raw
}

let seedSeq = 0

/** Seed a PENDING telegram delivery on a connection — for unlink/relink cancellation assertions. */
export async function seedPendingTelegramDelivery(
  prisma: PrismaService,
  recipientUserId: string,
  targetRef: string,
  targetKey: string
): Promise<void> {
  seedSeq += 1
  const note = await prisma.notification.create({
    data: {
      recipientUserId,
      type: 'account.telegram_linked',
      category: 'account',
      schemaVersion: 1,
      payload: {},
      idempotencyKey: `seed:${seedSeq}-${Date.now()}`,
      idempotencyFingerprint: 'fp',
      occurredAt: new Date(),
    },
    select: { id: true },
  })
  await prisma.notificationDelivery.create({
    data: {
      notificationId: note.id,
      channel: 'telegram',
      targetKey,
      targetRef,
      locale: 'en',
      status: 'PENDING',
      maxAttempts: 5,
    },
  })
}

export function postUpdate(app: INestApplication, body: object, secret = TG_SECRET): request.Test {
  return request(app.getHttpServer())
    .post('/webhooks/telegram')
    .set('x-telegram-bot-api-secret-token', secret)
    .send(body)
}
