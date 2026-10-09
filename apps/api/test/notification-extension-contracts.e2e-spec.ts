import { DEFAULT_LOCALE } from '@amcore/shared'

import { NotificationIdempotencyConflictError } from '../src/core/notifications/notification.errors'
import { NotificationDefinitionRegistry } from '../src/core/notifications/notification-definition.registry'
import { notificationIntent } from '../src/core/notifications/notification-intent'
import { NotificationsService } from '../src/core/notifications/notifications.service'

import { deferred, until } from './fixtures/ai-run-controls'
import {
  fixtureRecipient,
  setupNotificationExtensions,
} from './fixtures/extension-contracts/notification-context'
import { fixtureV1 } from './fixtures/extension-contracts/notification-registration'
import { cleanDatabase, type E2ETestContext, teardownE2ETest } from './helpers'

/** PostgreSQL proves occurrence replay, transaction visibility and unique-insert arbitration. */
describe('Versioned notification extensions (PostgreSQL)', () => {
  let context: E2ETestContext
  let producer: NotificationsService
  beforeAll(async () => {
    context = await setupNotificationExtensions()
    producer = context.app.get(NotificationsService)
  }, 180000)
  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
  })

  async function seedV1(userId: string, key = 'extension.fixture:old') {
    const input = {
      recipientUserId: userId,
      type: fixtureV1.type,
      payload: { text: 'old' },
      idempotencyKey: key,
    }
    const intent = notificationIntent(fixtureV1, input)
    return context.prisma.notification.create({
      data: {
        recipientUserId: userId,
        type: fixtureV1.type,
        category: fixtureV1.category,
        schemaVersion: 1,
        occurredAt: new Date(),
        payload: intent.payload as never,
        idempotencyKey: key,
        idempotencyFingerprint: intent.fingerprint,
        deliveries: {
          create: {
            channel: 'fixture_channel',
            targetKey: 'original-subscription',
            targetRef: 'original-ref',
            locale: 'ru',
            maxAttempts: 5,
            requestContractVersion: 1,
          },
        },
      },
    })
  }

  it('keeps historical normalization and immutable targets; fresh recipients use current version in one batch', async () => {
    const oldUser = await fixtureRecipient(context)
    const newUser = await fixtureRecipient(context)
    const old = await seedV1(oldUser)
    const batch = await context.prisma.$transaction(async (tx) => [
      await producer.notifyTx(tx, {
        recipientUserId: oldUser,
        type: fixtureV1.type,
        payload: { text: ' old ' },
        idempotencyKey: 'extension.fixture:old',
      }),
      await producer.notifyTx(tx, {
        recipientUserId: newUser,
        type: fixtureV1.type,
        payload: { text: 'new' },
        idempotencyKey: 'extension.fixture:old',
      }),
    ])
    expect(batch.map((item) => item.created)).toEqual([false, true])
    const stored = await context.prisma.notification.findMany({ orderBy: { createdAt: 'asc' } })
    expect(stored.map((item) => item.schemaVersion).sort()).toEqual([1, 2])
    const targets = await context.prisma.notificationDelivery.findMany({
      where: { notificationId: old.id },
    })
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      targetKey: 'original-subscription',
      targetRef: 'original-ref',
      locale: 'ru',
    })
    const registry = context.app.get(NotificationDefinitionRegistry)
    expect(registry.renderStored(old.type, 1, old.payload, DEFAULT_LOCALE).title).toBe('Version 1')
  })

  it('rolls back the entire mixed batch on a historical occurrence conflict', async () => {
    const oldUser = await fixtureRecipient(context)
    const newUser = await fixtureRecipient(context)
    await seedV1(oldUser)
    await expect(
      context.prisma.$transaction(async (tx) => {
        await producer.notifyTx(tx, {
          recipientUserId: newUser,
          type: fixtureV1.type,
          payload: { text: 'new' },
          idempotencyKey: 'extension.fixture:batch',
        })
        await producer.notifyTx(tx, {
          recipientUserId: oldUser,
          type: fixtureV1.type,
          payload: { text: 'different' },
          idempotencyKey: 'extension.fixture:old',
        })
      })
    ).rejects.toBeInstanceOf(NotificationIdempotencyConflictError)
    expect(await context.prisma.notification.count()).toBe(1)
  })

  it('re-reads a concurrent v1 insert winner and compares using v1 normalization', async () => {
    const userId = await fixtureRecipient(context)
    const ready = deferred()
    const release = deferred()
    const key = 'extension.fixture:race'
    const input = {
      recipientUserId: userId,
      type: fixtureV1.type,
      payload: { text: 'same' },
      idempotencyKey: key,
    }
    const intent = notificationIntent(fixtureV1, input)
    const winner = context.prisma.$transaction(
      async (tx) => {
        await tx.notification.create({
          data: {
            recipientUserId: userId,
            type: fixtureV1.type,
            category: fixtureV1.category,
            schemaVersion: 1,
            occurredAt: new Date(),
            payload: intent.payload as never,
            idempotencyKey: key,
            idempotencyFingerprint: intent.fingerprint,
          },
        })
        ready.resolve()
        await release.promise
      },
      { timeout: 15000 }
    )
    await ready.promise
    let loserPid = 0
    const loser = context.prisma.$transaction(
      async (tx) => {
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
        loserPid = backend!.pid
        return producer.notifyTx(tx, input)
      },
      { timeout: 15000 }
    )
    try {
      await until(async () => {
        if (!loserPid) return false
        const [wait] = await context.prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = ${loserPid}`
        return wait?.waiting === true
      })
    } finally {
      release.resolve()
    }
    await winner
    expect((await loser).created).toBe(false)
    expect(await context.prisma.notification.count()).toBe(1)
    expect(await context.prisma.notificationDelivery.count()).toBe(0)
  })
})
