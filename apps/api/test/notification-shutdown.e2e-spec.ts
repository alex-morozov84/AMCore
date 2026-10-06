import { jest } from '@jest/globals'
import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'

import { ChannelDelivererRegistry } from '../src/core/notifications/channels/channel-deliverer.registry'
import type { ChannelDeliverer } from '../src/core/notifications/channels/channel-deliverer.types'
import { TelegramDeliveryError } from '../src/core/notifications/channels/telegram/telegram.constants'
import type { TelegramBotApiClient } from '../src/core/notifications/channels/telegram/telegram-bot-api.client'
import { TelegramChannelDeliverer } from '../src/core/notifications/channels/telegram/telegram-channel.deliverer'
import { NotificationAttemptAdmission } from '../src/core/notifications/dispatch/notification-attempt-admission'
import { NotificationDeliveryRepository } from '../src/core/notifications/dispatch/notification-delivery.repository'
import { NotificationDispatchGate } from '../src/core/notifications/dispatch/notification-dispatch.gate'
import { NotificationDispatchService } from '../src/core/notifications/dispatch/notification-dispatch.service'
import type { ClaimedDelivery } from '../src/core/notifications/dispatch/notification-dispatch.types'
import {
  CUTOFF,
  NotificationShutdownLatch,
} from '../src/core/notifications/dispatch/notification-shutdown.latch'
import { NotificationChannel } from '../src/core/notifications/notification.constants'
import { NotificationDefinitionRegistry } from '../src/core/notifications/notification-definition.registry'
import { EnvService } from '../src/env/env.service'
import type { PrismaService } from '../src/prisma'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

import {
  NotificationAttemptOutcome,
  NotificationDeliveryStatus,
  TelegramConnectionStatus,
} from '@/generated/prisma/client'
import { MetricsService } from '@/infrastructure/observability'

/**
 * Shutdown atomicity against real Postgres (R3-SEAL / R3-TX). Every test builds its OWN latch (the
 * latch is process-wide and monotonic) and drives the real repository/admission/dispatcher with a
 * hook that seals it BETWEEN two dependent writes of one interactive transaction. The guarded client
 * must then refuse the next query, the callback must reject and Postgres must roll the WHOLE
 * transaction back: no terminal delivery with an open attempt, no claimed row without its attempt,
 * no half-applied cancellation. The control case seals after the last query and the commit stands.
 */
describe('Notification shutdown atomicity (e2e, real Postgres)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let logger: PinoLogger

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    logger = app.get(PinoLogger, { strict: false })
    for (const job of app.get(SchedulerRegistry, { strict: false }).getCronJobs().values())
      job.stop()
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  type Hook = () => void | Promise<void>
  /**
   * A `PrismaService`-shaped runner whose transactions run against the real database but whose
   * delegate/raw calls invoke `hooks[name]` AFTER the real statement ran (names:
   * `notificationDelivery.updateMany`, `notificationDeliveryAttempt.updateMany`, `$queryRaw`, …).
   */
  function hookedPrisma(hooks: Record<string, Hook>): PrismaService {
    const wrapDelegate = (prefix: string, delegate: Record<string, unknown>): unknown =>
      new Proxy(delegate, {
        get(target, prop: string) {
          const value = target[prop]
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            const result = (value as (...a: unknown[]) => PromiseLike<unknown>).apply(target, args)
            const hook = hooks[`${prefix}.${prop}`]
            return hook ? Promise.resolve(result).then(async (r) => (await hook(), r)) : result
          }
        },
      })
    const wrapTx = (tx: Record<string, unknown>): unknown =>
      new Proxy(tx, {
        get(target, prop: string) {
          const value = target[prop]
          if (prop === '$queryRaw' && typeof value === 'function') {
            return (...args: unknown[]) => {
              const result = (value as (...a: unknown[]) => PromiseLike<unknown>).apply(
                target,
                args
              )
              const hook = hooks.$queryRaw
              return hook ? Promise.resolve(result).then(async (r) => (await hook(), r)) : result
            }
          }
          if (
            value &&
            typeof value === 'object' &&
            !prop.startsWith('$') &&
            !prop.startsWith('_')
          ) {
            return wrapDelegate(prop, value as Record<string, unknown>)
          }
          return typeof value === 'function'
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value
        },
      })
    return {
      $transaction: (callback: (tx: unknown) => Promise<unknown>, options?: unknown) =>
        (prisma.$transaction as unknown as (cb: unknown, o?: unknown) => Promise<unknown>)(
          (tx: Record<string, unknown>) => callback(wrapTx(tx)),
          options
        ),
    } as unknown as PrismaService
  }

  let seq = 0
  async function seedDelivery(
    overrides: { status?: NotificationDeliveryStatus } = {}
  ): Promise<string> {
    seq += 1
    const user = await prisma.user.create({
      data: {
        email: `shutdown-${Date.now()}-${seq}@example.com`,
        emailCanonical: `shutdown-${Date.now()}-${seq}@example.com`,
        passwordHash: 'x',
      },
      select: { id: true },
    })
    const note = await prisma.notification.create({
      data: {
        recipientUserId: user.id,
        type: 'account.profile_updated',
        category: 'account',
        schemaVersion: 1,
        payload: { updatedFields: ['name'] },
        idempotencyKey: `account.profile_updated:shutdown-${Date.now()}-${seq}`,
        idempotencyFingerprint: `fp-${seq}`,
        occurredAt: new Date(),
      },
      select: { id: true },
    })
    const delivery = await prisma.notificationDelivery.create({
      data: {
        notificationId: note.id,
        channel: NotificationChannel.EMAIL,
        targetKey: `shutdown-${Date.now()}-${seq}@example.com`,
        locale: 'en',
        status: overrides.status ?? NotificationDeliveryStatus.PENDING,
        maxAttempts: 5,
      },
      select: { id: true },
    })
    return delivery.id
  }

  async function snapshot(deliveryId: string) {
    const delivery = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    })
    const attempts = await prisma.notificationDeliveryAttempt.findMany({ where: { deliveryId } })
    return { delivery, attempts }
  }

  const newLatch = (): NotificationShutdownLatch => new NotificationShutdownLatch(logger)

  describe('cutoff BETWEEN dependent writes rolls the whole transaction back', () => {
    it('Telegram fence: connection block then sibling cancel — both roll back across cutoff', async () => {
      const deliveryId = await seedDelivery()
      const { notification } = await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
        include: { notification: true },
      })
      const connection = await prisma.telegramConnection.create({
        data: {
          userId: notification.recipientUserId,
          chatId: '777',
          telegramUserId: '777',
        },
      })
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: {
          channel: NotificationChannel.TELEGRAM,
          targetRef: connection.id,
          targetKey: connection.chatId,
        },
      })
      const siblingNotification = await prisma.notification.create({
        data: {
          recipientUserId: notification.recipientUserId,
          type: notification.type,
          category: notification.category,
          schemaVersion: 1,
          payload: { updatedFields: ['name'] },
          idempotencyKey: `${notification.idempotencyKey}:sibling`,
          idempotencyFingerprint: 'sibling-fingerprint',
          occurredAt: new Date(),
        },
      })
      const sibling = await prisma.notificationDelivery.create({
        data: {
          notificationId: siblingNotification.id,
          channel: NotificationChannel.TELEGRAM,
          targetKey: connection.chatId,
          targetRef: connection.id,
          locale: 'en',
          maxAttempts: 5,
          availableAt: new Date(Date.now() + 600_000),
        },
      })
      const setup = new NotificationDeliveryRepository(prisma, newLatch())
      const [claim] = (await setup.claimDueBatch(1)) as ClaimedDelivery[]
      expect(claim!.id).toBe(deliveryId)
      const latch = newLatch()
      const hooked = hookedPrisma({ 'telegramConnection.updateMany': () => latch.seal() })
      const client = {
        sendMessage: jest.fn(async () => ({
          status: 'permanent',
          errorCode: TelegramDeliveryError.BLOCKED,
        })),
      } as unknown as TelegramBotApiClient
      const adapter = new TelegramChannelDeliverer(
        app.get(NotificationDefinitionRegistry),
        client,
        hooked,
        app.get(EnvService),
        latch
      )
      const admission = new NotificationAttemptAdmission(hooked, latch).create(
        { delivery: claim!, notification },
        adapter,
        { signal: new AbortController().signal, onTransportStarted: () => undefined }
      )
      await adapter.deliver({ delivery: claim!, notification }, admission)
      // This query waits on the real connection lock until Prisma has completed rollback.
      const after = await prisma.$queryRaw<{ status: string }[]>`
        SELECT status FROM "notifications"."telegram_connections"
        WHERE id = ${connection.id} FOR UPDATE`
      expect(after[0]!.status).toBe(TelegramConnectionStatus.ACTIVE)
      expect((await snapshot(sibling.id)).delivery.status).toBe(NotificationDeliveryStatus.PENDING)
      expect((await snapshot(deliveryId)).attempts[0]!.outcome).toBeNull()
      expect(latch.sealed).toBe(true)
      expect(client.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('finalize: delivery update then attempt close — nothing is committed', async () => {
      const deliveryId = await seedDelivery()
      const setup = new NotificationDeliveryRepository(prisma, newLatch())
      const [claim] = (await setup.claimDueBatch(1)) as ClaimedDelivery[]

      const latch = newLatch()
      const repository = new NotificationDeliveryRepository(
        hookedPrisma({ 'notificationDelivery.updateMany': () => latch.seal() }),
        latch
      )
      const result = await repository.finalizeDelivered(claim!, 'prov', 5)

      expect(result).toEqual({ state: 'cutoff' })
      const { delivery, attempts } = await snapshot(deliveryId)
      // Rolled back: still the claimed state — NOT a terminal delivery with an open attempt.
      expect(delivery.status).toBe(NotificationDeliveryStatus.PROCESSING)
      expect(delivery.leaseToken).toBe(claim!.leaseToken)
      expect(delivery.deliveredAt).toBeNull()
      expect(attempts).toHaveLength(1)
      expect(attempts[0]!.outcome).toBeNull()
    })

    it('claim: delivery lease update then attempt insert — no claimed row without its attempt', async () => {
      const deliveryId = await seedDelivery()
      const latch = newLatch()
      const repository = new NotificationDeliveryRepository(
        hookedPrisma({ $queryRaw: () => latch.seal() }), // right after the claim UPDATE ... RETURNING
        latch
      )

      const result = await repository.claimDueBatch(1)

      expect(result).toBe(CUTOFF)
      const { delivery, attempts } = await snapshot(deliveryId)
      expect(delivery.status).toBe(NotificationDeliveryStatus.PENDING) // original state restored
      expect(delivery.attemptCount).toBe(0) // no attempt budget spent
      expect(delivery.leaseToken).toBeNull()
      expect(attempts).toHaveLength(0)
    })

    it('reaper: a pass sealed mid-way is rolled back as a whole (the next pass redoes it)', async () => {
      const deliveryId = await seedDelivery()
      const [claim] = (await new NotificationDeliveryRepository(prisma, newLatch()).claimDueBatch(
        1
      )) as ClaimedDelivery[]
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { leaseExpiresAt: new Date(0) },
      })
      const latch = newLatch()
      const repository = new NotificationDeliveryRepository(
        hookedPrisma({ 'notificationDelivery.update': () => latch.seal() }),
        latch
      )

      expect(await repository.reapExpiredLeases()).toBe(CUTOFF)

      const { delivery, attempts } = await snapshot(deliveryId)
      expect(delivery.status).toBe(NotificationDeliveryStatus.PROCESSING) // not half-reaped
      expect(delivery.leaseToken).toBe(claim!.leaseToken)
      expect(attempts[0]!.outcome).toBeNull()
      // The unsealed reaper later recovers it normally (lease expiry → reaper).
      const redo = await new NotificationDeliveryRepository(prisma, newLatch()).reapExpiredLeases()
      expect(redo).toEqual({ rescheduled: 1, deadLettered: 0 })
    })

    it('admission target-cancel: delivery cancel then attempt close — neither is committed', async () => {
      const deliveryId = await seedDelivery()
      const [claim] = (await new NotificationDeliveryRepository(prisma, newLatch()).claimDueBatch(
        1
      )) as ClaimedDelivery[]
      const latch = newLatch()
      const admission = new NotificationAttemptAdmission(
        hookedPrisma({ 'notificationDelivery.updateMany': () => latch.seal() }),
        latch
      )
      const send = jest.fn(async () => 'sent')
      const deliverer = {
        channel: NotificationChannel.EMAIL,
        deliver: jest.fn(),
        checkTarget: async () => ({ reason: 'test_target_revoked' }),
      } as unknown as ChannelDeliverer

      const result = await admission
        .create(
          { delivery: claim!, notification: { id: claim!.notificationId } as never },
          deliverer,
          { signal: new AbortController().signal, onTransportStarted: () => undefined }
        )
        .send(send)

      expect(result).toEqual({ status: 'not_started', reason: 'closed' })
      expect(send).not.toHaveBeenCalled()
      const { delivery, attempts } = await snapshot(deliveryId)
      expect(delivery.status).toBe(NotificationDeliveryStatus.PROCESSING) // cancel rolled back
      expect(attempts[0]!.outcome).toBeNull()
    })

    it('control: a seal after the LAST query still commits atomically (caller only learns cutoff)', async () => {
      const deliveryId = await seedDelivery()
      const [claim] = (await new NotificationDeliveryRepository(prisma, newLatch()).claimDueBatch(
        1
      )) as ClaimedDelivery[]
      const latch = newLatch()
      const repository = new NotificationDeliveryRepository(
        hookedPrisma({ 'notificationDeliveryAttempt.updateMany': () => latch.seal() }),
        latch
      )

      const result = await repository.finalizeDelivered(claim!, 'prov', 5)

      expect(result).toEqual({ state: 'cutoff' }) // the caller stopped waiting ...
      await sleep(100)
      const { delivery, attempts } = await snapshot(deliveryId)
      expect(delivery.status).toBe(NotificationDeliveryStatus.DELIVERED) // ... but it DID commit
      expect(attempts[0]!.outcome).toBe(NotificationAttemptOutcome.DELIVERED)
    })
  })

  describe('shutdown with a finalize blocked on a row lock', () => {
    it('releases the dispatcher at the grace, never half-writes, and recovers via lease expiry → reaper', async () => {
      const deliveryId = await seedDelivery()
      const latch = newLatch()
      const repository = new NotificationDeliveryRepository(prisma, latch)
      const releaseExternalLock = (() => {
        let resolve!: () => void
        const promise = new Promise<void>((res) => (resolve = res))
        return { promise, resolve }
      })()
      let externalHolder: Promise<void> | undefined

      // A deliverer that, once it has the claimed row, makes another connection take its lock —
      // so the dispatcher's finalize then blocks on it.
      const deliverer: ChannelDeliverer = {
        channel: NotificationChannel.EMAIL,
        deliver: async () => {
          const locked = new Promise<void>((resolveLocked) => {
            externalHolder = prisma.$transaction(
              async (tx) => {
                await tx.$queryRaw`SELECT id FROM "notifications"."notification_deliveries" WHERE id = ${deliveryId} FOR UPDATE`
                resolveLocked()
                await releaseExternalLock.promise
              },
              { timeout: 30_000 }
            )
          })
          await locked
          return { status: 'delivered' }
        },
      }
      const service = new NotificationDispatchService(
        prisma,
        repository,
        new ChannelDelivererRegistry([deliverer]),
        app.get(MetricsService, { strict: false }),
        logger,
        latch,
        new NotificationDispatchGate(latch, 2),
        // Admission is bypassed here: the point is the BLOCKED FINALIZE, not the start fence.
        {
          create: (
            _c: unknown,
            _d: unknown,
            rt: { signal: AbortSignal; onTransportStarted: (p: Promise<unknown>) => void }
          ) => ({
            send: async (transport: (s: AbortSignal) => Promise<unknown>) => {
              const started = transport(rt.signal)
              rt.onTransportStarted(started)
              return started
            },
          }),
        } as unknown as NotificationAttemptAdmission
      )
      service.shutdownGraceMs = 500

      const drain = service.drainDueBatches()
      await sleep(300) // claim done, deliverer ran, finalize now blocked on the external lock
      const startedAt = Date.now()
      await service.shutdown() // seals at ~500 ms although finalize is still blocked
      const waited = Date.now() - startedAt
      await drain // the lane work promise was released by the seal

      expect(latch.sealed).toBe(true)
      expect(waited).toBeLessThan(5_000) // bounded by the grace, not by the lock hold
      // Zero new work after the seal: recovery entry returns at once.
      await service.runDispatchCycle()
      await service.drainDueBatches()

      releaseExternalLock.resolve() // the blocked UPDATE finally runs ...
      await externalHolder
      await sleep(300)

      // ... but the sealed guard refuses the NEXT query of that transaction (attempt close), so the
      // whole finalize rolled back: exactly the claimed state, an open attempt, nothing half-written.
      const { delivery, attempts } = await snapshot(deliveryId)
      expect(delivery.status).toBe(NotificationDeliveryStatus.PROCESSING)
      expect(delivery.deliveredAt).toBeNull()
      expect(attempts).toHaveLength(1)
      expect(attempts[0]!.outcome).toBeNull()

      // Recovery after "restart": lease expiry → reaper (attempt budget spent per contract).
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { leaseExpiresAt: new Date(0) },
      })
      const reaped = await new NotificationDeliveryRepository(
        prisma,
        newLatch()
      ).reapExpiredLeases()
      expect(reaped).toEqual({ rescheduled: 1, deadLettered: 0 })
    }, 60000)
  })
})
