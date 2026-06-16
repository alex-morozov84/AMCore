import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import type { PrismaService } from '../../prisma'

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

const VALID_INPUT: NotifyInput = {
  recipientUserId: 'user-1',
  type: 'account.test',
  payload: { value: 'hello' },
  idempotencyKey: 'account.test:1',
}

describe('NotificationsService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let preferences: DeepMockProxy<NotificationPreferenceRepository>
  let service: NotificationsService

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    preferences = mockDeep<NotificationPreferenceRepository>()
    service = new NotificationsService(
      prisma,
      new NotificationDefinitionRegistry([testDefinition]),
      new NotificationPreferenceResolver(),
      preferences
    )

    preferences.getMasterToggle.mockResolvedValue(true)
    preferences.findByUser.mockResolvedValue([])
    prisma.user.findUnique.mockResolvedValue({ locale: 'ru' } as never)
    // Run the transaction callback against the same mock client. Cast the impl —
    // $transaction's array/callback overload union is not worth modelling in a mock.
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
  })

  it('creates the notification and an in-app delivery, returning created=true', async () => {
    prisma.notification.createManyAndReturn.mockResolvedValue([{ id: 'n1' }] as never)
    prisma.notificationDelivery.create.mockResolvedValue({} as never)

    const result = await service.notify(VALID_INPUT)

    expect(result).toEqual({
      notificationId: 'n1',
      created: true,
      channels: [NotificationChannel.IN_APP],
    })
    expect(prisma.notificationDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notificationId: 'n1',
        channel: NotificationChannel.IN_APP,
        targetKey: 'feed',
        status: 'DELIVERED',
      }),
    })
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
    expect(prisma.notificationDelivery.create).not.toHaveBeenCalled()
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
      preferences
    )

    await expect(
      localService.notify({ ...VALID_INPUT, type: 'account.bad_action' })
    ).rejects.toThrow()
    expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('notifyTx reads and writes on the caller transaction, not the global client', async () => {
    const tx = mockDeep<PrismaService>()
    tx.notification.createManyAndReturn.mockResolvedValue([{ id: 'n2' }] as never)
    tx.notificationDelivery.create.mockResolvedValue({} as never)
    tx.user.findUnique.mockResolvedValue({ locale: 'ru' } as never)

    const result = await service.notifyTx(tx, VALID_INPUT)

    expect(result.notificationId).toBe('n2')
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.notification.createManyAndReturn).toHaveBeenCalled()
    // Resolution reads must use the caller transaction's snapshot, not the base client.
    expect(preferences.getMasterToggle).toHaveBeenCalledWith('user-1', tx)
    expect(preferences.findByUser).toHaveBeenCalledWith('user-1', tx)
    expect(tx.user.findUnique).toHaveBeenCalled()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
