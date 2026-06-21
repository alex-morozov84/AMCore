import request from 'supertest'

import {
  createTgUser,
  postUpdate,
  resetTelegramE2E,
  seedPendingTelegramDelivery,
  setupTelegramE2E,
  startUpdate,
  teardownTelegramE2E,
  type TelegramE2E,
} from './telegram-e2e.helpers'

/**
 * Telegram delivery + bearer-lifecycle merge gate (Arc D / D.7). The lifecycle drives the REAL
 * bearer endpoints (issue → bind → status → unlink cancellation); delivery exercises the first
 * shipped path, optional-default `account.password_changed`, plus the provider retry/permanent
 * taxonomy against the fake Bot API.
 */
describe('Telegram delivery + lifecycle (e2e)', () => {
  let tg: TelegramE2E
  let keySeq = 0

  beforeAll(async () => {
    tg = await setupTelegramE2E()
  }, 120000)
  afterAll(async () => teardownTelegramE2E(tg), 120000)
  beforeEach(async () => resetTelegramE2E(tg))

  async function linkedUser(chatId: string): Promise<string> {
    const userId = await createTgUser(tg.prisma)
    await tg.prisma.telegramConnection.create({
      data: { userId, chatId, telegramUserId: chatId, status: 'ACTIVE' },
    })
    return userId
  }

  /** Produce `account.password_changed` and return its Telegram delivery id. */
  async function notifyPasswordChanged(userId: string): Promise<string> {
    keySeq += 1
    const result = await tg.notifications.notify({
      recipientUserId: userId,
      type: 'account.password_changed',
      payload: { changedAt: new Date().toISOString() },
      idempotencyKey: `account.password_changed:e2e-${keySeq}`,
    })
    const delivery = await tg.prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: result.notificationId, channel: 'telegram' },
    })
    return delivery.id
  }

  it('bearer lifecycle: link → bind → status → unlink cancels due deliveries', async () => {
    const email = `tg-life-${Date.now()}@example.com`
    const reg = await request(tg.app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'StrongP@ss123' })
      .expect(201)
    const auth = `Bearer ${reg.body.accessToken as string}`

    const link = await request(tg.app.getHttpServer())
      .post('/notifications/telegram/link')
      .set('Authorization', auth)
      .expect(201)
    const token = (link.body.url as string).split('start=')[1]!

    await postUpdate(tg.app, startUpdate(900, 5550001, token)).expect(200)

    const status = await request(tg.app.getHttpServer())
      .get('/notifications/telegram/connection')
      .set('Authorization', auth)
      .expect(200)
    expect(status.body).toMatchObject({ connected: true, status: 'active' })

    // A PENDING telegram delivery that unlink must cancel.
    const conn = await tg.prisma.telegramConnection.findUniqueOrThrow({
      where: { userId: reg.body.user.id as string },
    })
    await seedPendingTelegramDelivery(tg.prisma, reg.body.user.id, conn.id, '5550001')

    await request(tg.app.getHttpServer())
      .delete('/notifications/telegram/connection')
      .set('Authorization', auth)
      .expect(204)

    expect(await tg.prisma.telegramConnection.count({ where: { id: conn.id } })).toBe(0)
    const cancelled = await tg.prisma.notificationDelivery.findFirstOrThrow({
      where: { targetRef: conn.id },
    })
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.terminalReasonCode).toBe('telegram_connection_unlinked')

    // Idempotent: a second unlink is still 204; status then reports disconnected.
    await request(tg.app.getHttpServer())
      .delete('/notifications/telegram/connection')
      .set('Authorization', auth)
      .expect(204)
    const after = await request(tg.app.getHttpServer())
      .get('/notifications/telegram/connection')
      .set('Authorization', auth)
      .expect(200)
    expect(after.body).toEqual({ connected: false, status: null, linkedAt: null })
  })

  it('delivers account.password_changed to a linked user (DELIVERED, fake got the chat id)', async () => {
    const deliveryId = await notifyPasswordChanged(await linkedUser('2002'))
    await tg.dispatch.runDispatchCycle()
    const row = await tg.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    })
    expect(row.status).toBe('DELIVERED')
    expect(tg.fake.sendCalls.at(-1)?.chat_id).toBe('2002')
  })

  it('skips account.password_changed on Telegram for an unlinked user (telegram_not_linked)', async () => {
    const deliveryId = await notifyPasswordChanged(await createTgUser(tg.prisma))
    const row = await tg.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    })
    expect(row.status).toBe('SKIPPED')
    expect(row.terminalReasonCode).toBe('telegram_not_linked')
  })

  it('429 retry_after → RETRY_SCHEDULED honoring the floor', async () => {
    const deliveryId = await notifyPasswordChanged(await linkedUser('3003'))
    tg.fake.setSendResponse(429, { ok: false, parameters: { retry_after: 120 } })
    await tg.dispatch.runDispatchCycle()
    const row = await tg.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    })
    expect(row.status).toBe('RETRY_SCHEDULED')
    expect(row.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(110_000)
  })

  it('403 → FAILED and the connection is fenced to BLOCKED', async () => {
    const userId = await linkedUser('4004')
    const deliveryId = await notifyPasswordChanged(userId)
    tg.fake.setSendResponse(403, { ok: false, description: 'Forbidden: bot was blocked' })
    await tg.dispatch.runDispatchCycle()
    const row = await tg.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    })
    expect(row.status).toBe('FAILED')
    expect(
      (await tg.prisma.telegramConnection.findUniqueOrThrow({ where: { userId } })).status
    ).toBe('BLOCKED')
  })
})
