import request from 'supertest'

import { TelegramLinkService } from '../src/core/notifications/channels/telegram/telegram-link.service'
import { NotificationDeliveryRepository } from '../src/core/notifications/dispatch/notification-delivery.repository'
import type { ClaimedDelivery } from '../src/core/notifications/dispatch/notification-dispatch.types'
import { CUTOFF } from '../src/core/notifications/dispatch/notification-shutdown.latch'

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

  describe('revoked-target races (C3 / E3, real Postgres)', () => {
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
    function deferred<T = void>() {
      let resolve!: (value: T) => void
      const promise = new Promise<T>((res) => {
        resolve = res
      })
      return { promise, resolve }
    }
    const repo = () => tg.app.get(NotificationDeliveryRepository, { strict: false })
    const links = () => tg.app.get(TelegramLinkService, { strict: false })

    async function claimOne(): Promise<ClaimedDelivery> {
      // `account.password_changed` also fans out to email: keep only the Telegram deliveries due.
      await tg.prisma.notificationDelivery.updateMany({
        where: { channel: { not: 'telegram' }, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })
      const claimed = await repo().claimDueBatch(1)
      if (claimed === CUTOFF) throw new Error('unexpected cutoff')
      return claimed[0]!
    }
    async function relink(userId: string, chatId: string): Promise<string> {
      const connection = await tg.prisma.telegramConnection.create({
        data: { userId, chatId, telegramUserId: chatId, status: 'ACTIVE' },
        select: { id: true },
      })
      return connection.id
    }

    it('unlink while a delivery is PROCESSING: cancelled, attempt closed, no resurrection, new connection usable', async () => {
      const userId = await linkedUser('5005')
      const deliveryId = await notifyPasswordChanged(userId)
      const oldClaim = await claimOne() // PROCESSING, lease held by the "old holder"
      expect(oldClaim.id).toBe(deliveryId)

      await links().unlink(userId) // revoke
      const newConnectionId = await relink(userId, '5005') // relink: a fresh generation

      const cancelled = await tg.prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
      })
      expect(cancelled.status).toBe('CANCELLED')
      expect(cancelled.terminalReasonCode).toBe('telegram_connection_unlinked')
      expect(cancelled.leaseToken).toBeNull()
      const attempt = await tg.prisma.notificationDeliveryAttempt.findFirstOrThrow({
        where: { deliveryId },
      })
      expect(attempt.outcome).toBe('ABANDONED')
      expect(attempt.errorCode).toBe('delivery_cancelled')

      // The old holder's transient finalize and a reaper pass can neither resurrect the row ...
      expect(
        (await repo().finalizeTransient(oldClaim, 'telegram_provider_transient', 5)).state
      ).toBe('lease_lost')
      await tg.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { leaseExpiresAt: new Date(0) },
      })
      await tg.dispatch.reapExpiredLeases()
      await tg.dispatch.runDispatchCycle()
      expect(tg.fake.sendCalls).toHaveLength(0) // ... nor reach the Bot API for the old generation
      expect(
        (await tg.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } }))
          .status
      ).toBe('CANCELLED')

      // The relinked connection is untouched and works.
      expect(
        (await tg.prisma.telegramConnection.findUniqueOrThrow({ where: { id: newConnectionId } }))
          .status
      ).toBe('ACTIVE')
      const freshDelivery = await notifyPasswordChanged(userId)
      await tg.dispatch.runDispatchCycle()
      expect(
        (await tg.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: freshDelivery } }))
          .status
      ).toBe('DELIVERED')
      expect(tg.fake.sendCalls).toHaveLength(1)
      expect(tg.fake.sendCalls[0]?.chat_id).toBe('5005')
    })

    it('reaper path: a PROCESSING row whose lease expired is cancelled by unlink and never re-drained', async () => {
      const userId = await linkedUser('5105')
      const deliveryId = await notifyPasswordChanged(userId)
      await claimOne()
      await tg.prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
      })

      await links().unlink(userId) // revoke BEFORE the reaper reclaims it
      await tg.dispatch.runDispatchCycle() // reap + drain

      expect(
        (await tg.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } }))
          .status
      ).toBe('CANCELLED')
      expect(tg.fake.sendCalls).toHaveLength(0)
    })

    it.each([['an absent / replaced generation', 'ghost-connection', 'telegram_target_revoked']])(
      'admission refuses %s without a prior cancellation pass: no Bot API call',
      async (_label, targetRef, reason) => {
        const userId = await createTgUser(tg.prisma)
        await seedPendingTelegramDelivery(tg.prisma, userId, targetRef, '7007')

        await tg.dispatch.runDispatchCycle()

        expect(tg.fake.sendCalls).toHaveLength(0)
        const row = await tg.prisma.notificationDelivery.findFirstOrThrow({ where: { targetRef } })
        expect(row.status).toBe('CANCELLED')
        expect(row.terminalReasonCode).toBe(reason)
        const attempt = await tg.prisma.notificationDeliveryAttempt.findFirstOrThrow({
          where: { deliveryId: row.id },
        })
        expect(attempt.outcome).toBe('ABANDONED')
        expect(attempt.errorCode).toBe('target_revoked')
      }
    )

    it('admission refuses a different chat, another recipient and a BLOCKED connection', async () => {
      const owner = await createTgUser(tg.prisma)
      const other = await createTgUser(tg.prisma)
      const connection = await tg.prisma.telegramConnection.create({
        data: { userId: owner, chatId: '8001', telegramUserId: '8001', status: 'ACTIVE' },
      })
      await seedPendingTelegramDelivery(tg.prisma, owner, connection.id, '9999') // wrong chat
      await seedPendingTelegramDelivery(tg.prisma, other, connection.id, '8001') // another recipient
      await tg.dispatch.runDispatchCycle()
      await tg.prisma.telegramConnection.update({
        where: { id: connection.id },
        data: { status: 'BLOCKED' },
      })
      await seedPendingTelegramDelivery(tg.prisma, owner, connection.id, '8001') // blocked
      await tg.dispatch.runDispatchCycle()

      expect(tg.fake.sendCalls).toHaveLength(0)
      const reasons = (
        await tg.prisma.notificationDelivery.findMany({ where: { targetRef: connection.id } })
      )
        .map((row) => row.terminalReasonCode)
        .sort()
      expect(reasons).toEqual([
        'telegram_connection_blocked',
        'telegram_target_revoked',
        'telegram_target_revoked',
      ])
    })

    it('producer BEFORE revoke: the revoke waits for the producer, then cancels its committed delivery', async () => {
      const userId = await linkedUser('5205')
      const inserted = deferred()
      const commit = deferred()
      let unlinked = false
      const producer = tg.prisma.$transaction(
        async (tx) => {
          await tg.notifications.notifyTx(tx, {
            recipientUserId: userId,
            type: 'account.password_changed',
            payload: { changedAt: new Date().toISOString() },
            idempotencyKey: 'account.password_changed:race-producer-first',
          })
          inserted.resolve()
          await commit.promise
        },
        { timeout: 30_000 }
      )
      await inserted.promise
      const unlinking = links()
        .unlink(userId)
        .then(() => {
          unlinked = true
        })
      await sleep(400)
      expect(unlinked).toBe(false) // blocked: the producer holds FOR SHARE on the connection row

      commit.resolve()
      await Promise.all([producer, unlinking])

      const delivery = await tg.prisma.notificationDelivery.findFirstOrThrow({
        where: { channel: 'telegram' },
      })
      expect(delivery.status).toBe('CANCELLED')
      expect(delivery.terminalReasonCode).toBe('telegram_connection_unlinked')
      expect(await tg.prisma.telegramConnection.count({ where: { userId } })).toBe(0)
    })

    it('revoke BEFORE producer: the producer finds no connection and writes SKIPPED telegram_not_linked', async () => {
      const userId = await linkedUser('5305')
      const locked = deferred()
      const release = deferred()
      const revoking = tg.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "notifications"."telegram_connections" WHERE "userId" = ${userId} FOR UPDATE`
          locked.resolve()
          await release.promise
          await tx.telegramConnection.delete({ where: { userId } })
        },
        { timeout: 30_000 }
      )
      await locked.promise
      const producing = tg.notifications.notify({
        recipientUserId: userId,
        type: 'account.password_changed',
        payload: { changedAt: new Date().toISOString() },
        idempotencyKey: 'account.password_changed:race-revoke-first',
      })
      await sleep(400)
      release.resolve()
      await Promise.all([revoking, producing])

      const delivery = await tg.prisma.notificationDelivery.findFirstOrThrow({
        where: { channel: 'telegram' },
      })
      expect(delivery.status).toBe('SKIPPED')
      expect(delivery.terminalReasonCode).toBe('telegram_not_linked')
    })

    it('a rolled-back notifyTx leaves no notification and no delivery', async () => {
      const userId = await linkedUser('5405')
      await expect(
        tg.prisma.$transaction(async (tx) => {
          await tg.notifications.notifyTx(tx, {
            recipientUserId: userId,
            type: 'account.password_changed',
            payload: { changedAt: new Date().toISOString() },
            idempotencyKey: 'account.password_changed:rolled-back',
          })
          throw new Error('business rollback')
        })
      ).rejects.toThrow('business rollback')
      expect(await tg.prisma.notification.count()).toBe(0)
      expect(await tg.prisma.notificationDelivery.count()).toBe(0)
    })

    it('concurrent unlinks are both clean no-op/ok (no stale delete, no 500)', async () => {
      const userId = await linkedUser('5505')
      await notifyPasswordChanged(userId)
      const results = await Promise.allSettled([links().unlink(userId), links().unlink(userId)])
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(await tg.prisma.telegramConnection.count({ where: { userId } })).toBe(0)
    })

    it('the initiating 403 keeps its permanent-failure trail; its sibling is CANCELLED, not dead-lettered', async () => {
      const userId = await linkedUser('5605')
      const siblingId = await notifyPasswordChanged(userId)
      const siblingClaim = await claimOne() // the sibling is PROCESSING elsewhere
      expect(siblingClaim.id).toBe(siblingId)
      const initiatorId = await notifyPasswordChanged(userId)
      tg.fake.setSendResponse(403, { ok: false, description: 'Forbidden: bot was blocked' })

      await tg.dispatch.runDispatchCycle() // claims + sends the initiator → 403 → fence

      const initiator = await tg.prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: initiatorId },
      })
      expect(initiator.status).toBe('FAILED')
      expect(initiator.terminalReasonCode).toBe('permanent_failure')
      const initiatorAttempt = await tg.prisma.notificationDeliveryAttempt.findFirstOrThrow({
        where: { deliveryId: initiatorId },
      })
      expect(initiatorAttempt.outcome).toBe('PERMANENT_FAILURE')

      const sibling = await tg.prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: siblingId },
      })
      expect(sibling.status).toBe('CANCELLED')
      expect(sibling.terminalReasonCode).toBe('telegram_connection_blocked')
      const siblingAttempt = await tg.prisma.notificationDeliveryAttempt.findFirstOrThrow({
        where: { deliveryId: siblingId },
      })
      expect(siblingAttempt.outcome).toBe('ABANDONED')
      expect((await repo().finalizeDelivered(siblingClaim, 'late', 1)).state).toBe('lease_lost')
      expect(
        (await tg.prisma.telegramConnection.findUniqueOrThrow({ where: { userId } })).status
      ).toBe('BLOCKED')
    })

    it('a late fence from an OLD generation cannot block a freshly relinked connection', async () => {
      const userId = await linkedUser('5705')
      const deliveryId = await notifyPasswordChanged(userId)
      await claimOne()
      await links().unlink(userId)
      const fresh = await relink(userId, '5705')
      // The stale holder's permanent 403 would fence its OLD connection id: that row is gone.
      tg.fake.setSendResponse(403, { ok: false, description: 'Forbidden: bot was blocked' })
      await tg.dispatch.runDispatchCycle()
      expect(
        (await tg.prisma.telegramConnection.findUniqueOrThrow({ where: { id: fresh } })).status
      ).toBe('ACTIVE')
      expect(
        (await tg.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } }))
          .status
      ).toBe('CANCELLED')
    })
  })
})
