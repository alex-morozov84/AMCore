import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

import type { PrismaService } from '../../prisma'

import { ChannelTargetResolverRegistry } from './channels/channel-target-resolver.registry'
import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from './notification.constants'
import { NotificationIdempotencyConflictError } from './notification.errors'
import { NotificationDefinitionRegistry } from './notification-definition.registry'
import type { NotificationDefinition } from './notification-definition.types'
import { notificationFingerprint } from './notification-fingerprint'
import { NotificationPreferenceRepository } from './notification-preference.repository'
import { NotificationPreferenceResolver } from './notification-preference.resolver'
import { NotificationsService, type NotifyInput } from './notifications.service'
import type { NotificationRealtimePublisher } from './realtime/notification-realtime.publisher'

import type { QueueService } from '@/infrastructure/queue/queue.service'

const testDefinition: NotificationDefinition = {
  type: 'account.test',
  category: NotificationCategory.ACCOUNT,
  schemaVersion: 1,
  contentClass: NotificationContentClass.PUBLIC,
  supportedChannels: [NotificationChannel.IN_APP],
  defaultChannels: [NotificationChannel.IN_APP],
  mandatoryChannels: [],
  externalModeByChannel: {},
  payloadSchema: z.object({ value: z.string() }),
  safePayload: (payload) => payload as Record<string, unknown>,
  renderInApp: () => ({ title: 't', body: 'b' }),
}

/** A definition that also delivers on email — exercises external target resolution.
 * SENSITIVE → generic external mode, so no `projectExternal` is required (B.1 tests
 * delivery materialization, not rendering). */
const emailDefinition: NotificationDefinition = {
  ...testDefinition,
  type: 'account.email_test',
  contentClass: NotificationContentClass.SENSITIVE,
  supportedChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
  defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
}

/** External-only: no IN_APP channel, so the feed never gains a row → no realtime hint. */
const emailOnlyDefinition: NotificationDefinition = {
  ...emailDefinition,
  type: 'account.email_only_test',
  supportedChannels: [NotificationChannel.EMAIL],
  defaultChannels: [NotificationChannel.EMAIL],
}

const VALID_INPUT: NotifyInput = {
  recipientUserId: 'user-1',
  type: 'account.test',
  payload: { value: 'hello' },
  idempotencyKey: 'account.test:1',
}

describe('NotificationsService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let preferences: DeepMockProxy<NotificationPreferenceRepository>
  let queue: DeepMockProxy<QueueService>
  let realtime: DeepMockProxy<NotificationRealtimePublisher>
  let logger: DeepMockProxy<PinoLogger>
  let service: NotificationsService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    preferences = mockDeep<NotificationPreferenceRepository>()
    queue = mockDeep<QueueService>()
    realtime = mockDeep<NotificationRealtimePublisher>()
    logger = mockDeep<PinoLogger>()
    service = new NotificationsService(
      prisma,
      new NotificationDefinitionRegistry([testDefinition]),
      new NotificationPreferenceResolver(),
      preferences,
      // In-app-only test definition → no external resolver is exercised; empty registry.
      new ChannelTargetResolverRegistry([]),
      queue,
      realtime,
      logger
    )

    preferences.getMasterToggle.mockResolvedValue(true)
    preferences.findByUser.mockResolvedValue([])
    prisma.user.findUnique.mockResolvedValue({
      locale: 'ru',
      email: 'u@example.com',
      emailCanonical: 'u@example.com',
      emailVerified: true,
    } as never)
    // Run the transaction callback against the same mock client. Cast the impl —
    // $transaction's array/callback overload union is not worth modelling in a mock.
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
  })

  it('creates the notification and an in-app delivery, returning created=true', async () => {
    prisma.notification.createManyAndReturn.mockResolvedValue([{ id: 'n1' }] as never)
    prisma.notificationDelivery.createMany.mockResolvedValue({ count: 1 } as never)

    const result = await service.notify(VALID_INPUT)

    expect(result).toEqual({
      notificationId: 'n1',
      created: true,
      channels: [NotificationChannel.IN_APP],
    })
    expect(prisma.notificationDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          notificationId: 'n1',
          channel: NotificationChannel.IN_APP,
          targetKey: 'feed',
          status: 'DELIVERED',
        }),
      ],
    })
    // In-app-only notification → no external PENDING delivery → no dispatch wake.
    expect(queue.add).not.toHaveBeenCalled()
    // A new in-app delivery exists → a best-effort realtime feed hint is published.
    expect(realtime.publish).toHaveBeenCalledWith('user-1', 'created', 'n1')
  })

  it('materializes a PENDING email delivery and wakes the dispatcher (verified recipient)', async () => {
    const emailService = new NotificationsService(
      prisma,
      new NotificationDefinitionRegistry([emailDefinition]),
      new NotificationPreferenceResolver(),
      preferences,
      new ChannelTargetResolverRegistry(), // default registry → real EmailTargetResolver
      queue,
      realtime,
      logger
    )
    prisma.notification.createManyAndReturn.mockResolvedValue([{ id: 'n1' }] as never)
    prisma.notificationDelivery.createMany.mockResolvedValue({ count: 2 } as never)

    const result = await emailService.notify({ ...VALID_INPUT, type: 'account.email_test' })

    expect(result.channels).toEqual([NotificationChannel.IN_APP, NotificationChannel.EMAIL])
    const createManyArg = prisma.notificationDelivery.createMany.mock.calls[0]![0] as {
      data: Array<{ channel: string; status: string; targetKey: string }>
    }
    expect(createManyArg.data).toEqual([
      expect.objectContaining({ channel: NotificationChannel.IN_APP, status: 'DELIVERED' }),
      expect.objectContaining({
        channel: NotificationChannel.EMAIL,
        status: 'PENDING',
        targetKey: 'u@example.com',
      }),
    ])
    // Fresh external PENDING delivery → exactly one best-effort dispatch wake.
    expect(queue.add).toHaveBeenCalledTimes(1)
    // In-app delivery exists alongside email → the feed hint is still published.
    expect(realtime.publish).toHaveBeenCalledWith('user-1', 'created', 'n1')
  })

  it('does not publish a realtime hint for an external-only notification', async () => {
    const externalOnlyService = new NotificationsService(
      prisma,
      new NotificationDefinitionRegistry([emailOnlyDefinition]),
      new NotificationPreferenceResolver(),
      preferences,
      new ChannelTargetResolverRegistry(),
      queue,
      realtime,
      logger
    )
    prisma.notification.createManyAndReturn.mockResolvedValue([{ id: 'n1' }] as never)
    prisma.notificationDelivery.createMany.mockResolvedValue({ count: 1 } as never)

    const result = await externalOnlyService.notify({
      ...VALID_INPUT,
      type: 'account.email_only_test',
    })

    // EMAIL-only → no in-app delivery → the feed never changed → no realtime hint,
    // but the dispatcher is still woken for the PENDING external delivery.
    expect(result.channels).toEqual([NotificationChannel.EMAIL])
    expect(realtime.publish).not.toHaveBeenCalled()
    expect(queue.add).toHaveBeenCalledTimes(1)
  })

  it('writes a SKIPPED email delivery and does not wake for an unverified recipient', async () => {
    const emailService = new NotificationsService(
      prisma,
      new NotificationDefinitionRegistry([emailDefinition]),
      new NotificationPreferenceResolver(),
      preferences,
      new ChannelTargetResolverRegistry(),
      queue,
      realtime,
      logger
    )
    prisma.user.findUnique.mockResolvedValue({
      locale: 'ru',
      email: 'u@example.com',
      emailCanonical: 'u@example.com',
      emailVerified: false,
    } as never)
    prisma.notification.createManyAndReturn.mockResolvedValue([{ id: 'n1' }] as never)
    prisma.notificationDelivery.createMany.mockResolvedValue({ count: 2 } as never)

    await emailService.notify({ ...VALID_INPUT, type: 'account.email_test' })

    const createManyArg = prisma.notificationDelivery.createMany.mock.calls[0]![0] as {
      data: Array<{ channel: string; status: string; terminalReasonCode?: string }>
    }
    expect(createManyArg.data).toContainEqual(
      expect.objectContaining({
        channel: NotificationChannel.EMAIL,
        status: 'SKIPPED',
        terminalReasonCode: 'destination_unverified',
      })
    )
    // SKIPPED is a terminal non-failure — it must not carry failedAt.
    const emailRow = createManyArg.data.find((d) => d.channel === NotificationChannel.EMAIL)!
    expect(emailRow).not.toHaveProperty('failedAt')
    // No deliverable external target → no wake.
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('returns the existing row on an idempotent replay (matching fingerprint)', async () => {
    const fingerprint = notificationFingerprint({
      type: 'account.test',
      category: NotificationCategory.ACCOUNT,
      schemaVersion: 1,
      payload: { value: 'hello' },
      action: null,
      organizationId: null,
      occurredAt: null,
    })
    prisma.notification.createManyAndReturn.mockResolvedValue([] as never)
    prisma.notification.findUniqueOrThrow.mockResolvedValue({
      id: 'existing',
      idempotencyFingerprint: fingerprint,
    } as never)
    // Replay reports the channels actually persisted, queried from the deliveries.
    prisma.notificationDelivery.findMany.mockResolvedValue([{ channel: 'in_app' }] as never)

    const result = await service.notify(VALID_INPUT)

    expect(result).toEqual({
      notificationId: 'existing',
      created: false,
      channels: [NotificationChannel.IN_APP],
    })
    expect(prisma.notificationDelivery.createMany).not.toHaveBeenCalled()
    expect(queue.add).not.toHaveBeenCalled()
    // An idempotent replay must not re-hint the feed.
    expect(realtime.publish).not.toHaveBeenCalled()
  })

  it('throws on idempotency-key reuse with a different fingerprint', async () => {
    prisma.notification.createManyAndReturn.mockResolvedValue([] as never)
    prisma.notification.findUniqueOrThrow.mockResolvedValue({
      id: 'existing',
      idempotencyFingerprint: 'different',
    } as never)

    await expect(service.notify(VALID_INPUT)).rejects.toThrow(NotificationIdempotencyConflictError)
  })

  it('rejects an unknown type and an invalid payload before writing', async () => {
    await expect(service.notify({ ...VALID_INPUT, type: 'does.not_exist' })).rejects.toThrow()
    await expect(service.notify({ ...VALID_INPUT, payload: { value: 123 } })).rejects.toThrow()
    expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('rejects an idempotency key that is empty, oversized, or not namespaced', async () => {
    for (const idempotencyKey of ['', 'x'.repeat(256), 'unnamespaced', 'a b:c', 'ns:bad\u0001']) {
      await expect(service.notify({ ...VALID_INPUT, idempotencyKey })).rejects.toThrow()
    }
    expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('rejects a definition action that violates the shared action schema', async () => {
    const badActionDef: NotificationDefinition = {
      ...testDefinition,
      type: 'account.bad_action',
      action: () => ({ route: 'https://evil.example' }),
    }
    const localService = new NotificationsService(
      prisma,
      new NotificationDefinitionRegistry([badActionDef]),
      new NotificationPreferenceResolver(),
      preferences,
      new ChannelTargetResolverRegistry([]),
      queue,
      realtime,
      logger
    )

    await expect(
      localService.notify({ ...VALID_INPUT, type: 'account.bad_action' })
    ).rejects.toThrow()
    expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('notifyTx reads and writes on the caller transaction, not the global client', async () => {
    const tx = mockDeep<PrismaService>()
    tx.notification.createManyAndReturn.mockResolvedValue([{ id: 'n2' }] as never)
    tx.notificationDelivery.createMany.mockResolvedValue({ count: 1 } as never)
    tx.user.findUnique.mockResolvedValue({
      locale: 'ru',
      email: 'u@example.com',
      emailCanonical: 'u@example.com',
      emailVerified: true,
    } as never)

    const result = await service.notifyTx(tx, VALID_INPUT)

    expect(result.notificationId).toBe('n2')
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.notification.createManyAndReturn).toHaveBeenCalled()
    // Resolution reads must use the caller transaction's snapshot, not the base client.
    expect(preferences.getMasterToggle).toHaveBeenCalledWith('user-1', tx)
    expect(preferences.findByUser).toHaveBeenCalledWith('user-1', tx)
    expect(tx.user.findUnique).toHaveBeenCalled()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    // notifyTx never publishes — the caller owns commit timing; resync/poller cover it.
    expect(realtime.publish).not.toHaveBeenCalled()
  })
})
