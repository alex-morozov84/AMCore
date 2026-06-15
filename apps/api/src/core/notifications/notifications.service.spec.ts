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
    const fingerprint = notificationFingerprint('account.test', 1, { value: 'hello' })
    prisma.notification.createManyAndReturn.mockResolvedValue([] as never)
    prisma.notification.findUniqueOrThrow.mockResolvedValue({
      id: 'existing',
      idempotencyFingerprint: fingerprint,
    } as never)

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

  it('notifyTx writes on the caller transaction without opening its own', async () => {
    const tx = mockDeep<PrismaService>()
    tx.notification.createManyAndReturn.mockResolvedValue([{ id: 'n2' }] as never)
    tx.notificationDelivery.create.mockResolvedValue({} as never)

    const result = await service.notifyTx(tx, VALID_INPUT)

    expect(result.notificationId).toBe('n2')
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(tx.notification.createManyAndReturn).toHaveBeenCalled()
  })
})
