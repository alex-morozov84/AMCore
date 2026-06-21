import type { Notification } from '@prisma/client'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import type { PrismaService } from '../../../../prisma'
import type { ClaimedDelivery } from '../../dispatch/notification-dispatch.types'
import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from '../../notification.constants'
import { NotificationDefinitionRegistry } from '../../notification-definition.registry'
import type { NotificationDefinition } from '../../notification-definition.types'
import type { DeliveryContext } from '../channel-deliverer.types'

import type { TelegramBotApiClient, TelegramSendResult } from './telegram-bot-api.client'
import { TelegramChannelDeliverer } from './telegram-channel.deliverer'
import { telegramGenericMessages } from './telegram-messages'

import type { EnvService } from '@/env/env.service'

const base = {
  category: NotificationCategory.PRODUCT,
  schemaVersion: 1,
  defaultChannels: [NotificationChannel.IN_APP],
  mandatoryChannels: [],
  externalModeByChannel: {},
  safePayload: (p: unknown) => p as Record<string, unknown>,
  renderInApp: () => ({ title: 'in-app', body: 'in-app' }),
} as const

const detailedDef: NotificationDefinition = {
  ...base,
  type: 'demo.detail',
  contentClass: NotificationContentClass.PUBLIC, // → telegram detailed
  supportedChannels: [NotificationChannel.IN_APP, NotificationChannel.TELEGRAM],
  payloadSchema: z.object({ v: z.string(), secret: z.string().optional() }),
  projectExternal: (_channel, payload) => ({ v: (payload as { v: string }).v }),
  renderTelegram: (projection) => ({ title: `Detailed ${String(projection.v)}`, body: 'tg body' }),
}

const genericDef: NotificationDefinition = {
  ...base,
  type: 'account.generic',
  contentClass: NotificationContentClass.SENSITIVE, // → telegram generic
  supportedChannels: [NotificationChannel.IN_APP, NotificationChannel.TELEGRAM],
  payloadSchema: z.object({}),
}

const claim = (overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery => ({
  id: 'd1',
  notificationId: 'n1',
  channel: NotificationChannel.TELEGRAM,
  targetKey: '999000',
  targetRef: 'conn-1',
  destinationSnapshot: null,
  locale: 'ru',
  attemptNumber: 1,
  maxAttempts: 5,
  leaseToken: 'lease',
  ...overrides,
})

const notification = (overrides: Partial<Notification> = {}): Notification =>
  ({ id: 'n1', type: 'account.generic', payload: {}, action: null, ...overrides }) as Notification

const context = (overrides: Partial<ClaimedDelivery> = {}, note: Partial<Notification> = {}) =>
  ({ delivery: claim(overrides), notification: notification(note) }) as DeliveryContext

describe('TelegramChannelDeliverer', () => {
  let client: { sendMessage: jest.Mock<Promise<TelegramSendResult>> }
  let prisma: DeepMockProxy<PrismaService>
  let env: { get: jest.Mock }
  let deliverer: TelegramChannelDeliverer

  beforeEach(() => {
    client = { sendMessage: jest.fn() }
    prisma = mockDeep<PrismaService>()
    env = { get: jest.fn().mockReturnValue('https://app.example') }
    deliverer = new TelegramChannelDeliverer(
      new NotificationDefinitionRegistry([detailedDef, genericDef]),
      client as unknown as TelegramBotApiClient,
      prisma as unknown as PrismaService,
      env as unknown as EnvService
    )
    // Run the fence transaction callback against the same mock client.
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
  })

  it('sends generic content to the chat and maps delivered', async () => {
    client.sendMessage.mockResolvedValue({ status: 'delivered', providerMessageId: '42' })
    const result = await deliverer.deliver(context())
    expect(result).toEqual({ status: 'delivered', providerMessageId: '42' })
    const [arg] = client.sendMessage.mock.calls[0]!
    expect(arg.chatId).toBe('999000')
    expect(arg.text).toContain(telegramGenericMessages.ru.title)
  })

  it('renders detailed content only from the allowlisted projection (no payload leak)', async () => {
    client.sendMessage.mockResolvedValue({ status: 'delivered' })
    await deliverer.deliver(
      context({}, { type: 'demo.detail', payload: { v: 'X', secret: 'topsecret' } })
    )
    const text = client.sendMessage.mock.calls[0]![0].text
    expect(text).toContain('Detailed X')
    expect(text).not.toContain('topsecret')
  })

  it('appends the trusted app link when the notification has a first-party action', async () => {
    client.sendMessage.mockResolvedValue({ status: 'delivered' })
    await deliverer.deliver(context({}, { action: { route: 'account.security' } }))
    expect(client.sendMessage.mock.calls[0]![0].text).toContain('https://app.example')
  })

  it('passes a transient result through with its retryAfterMs floor', async () => {
    client.sendMessage.mockResolvedValue({
      status: 'transient',
      errorCode: 'telegram_rate_limited',
      retryAfterMs: 30_000,
    })
    const result = await deliverer.deliver(context())
    expect(result).toEqual({
      status: 'transient',
      errorCode: 'telegram_rate_limited',
      retryAfterMs: 30_000,
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('fences the connection on a permanent destination error (block + cancel due deliveries)', async () => {
    client.sendMessage.mockResolvedValue({ status: 'permanent', errorCode: 'telegram_blocked' })
    prisma.telegramConnection.updateMany.mockResolvedValue({ count: 1 })

    const result = await deliverer.deliver(context())

    expect(result).toEqual({ status: 'permanent', errorCode: 'telegram_blocked' })
    expect(prisma.telegramConnection.updateMany).toHaveBeenCalledWith({
      where: { id: 'conn-1', chatId: '999000', status: 'ACTIVE' },
      data: { status: 'BLOCKED' },
    })
    expect(prisma.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          targetRef: 'conn-1',
          channel: NotificationChannel.TELEGRAM,
        }),
        data: expect.objectContaining({
          status: 'CANCELLED',
          terminalReasonCode: 'telegram_connection_blocked',
        }),
      })
    )
  })

  it('does NOT fence on a non-destination permanent (provider/config error)', async () => {
    client.sendMessage.mockResolvedValue({
      status: 'permanent',
      errorCode: 'telegram_provider_permanent',
    })
    const result = await deliverer.deliver(context())
    expect(result).toEqual({ status: 'permanent', errorCode: 'telegram_provider_permanent' })
    expect(prisma.telegramConnection.updateMany).not.toHaveBeenCalled()
  })

  it('does not cancel deliveries when the conditional block matches no row (generation fence)', async () => {
    client.sendMessage.mockResolvedValue({
      status: 'permanent',
      errorCode: 'telegram_chat_not_found',
    })
    prisma.telegramConnection.updateMany.mockResolvedValue({ count: 0 })

    await deliverer.deliver(context())

    expect(prisma.notificationDelivery.updateMany).not.toHaveBeenCalled()
  })

  it('declares the telegram channel', () => {
    expect(deliverer.channel).toBe(NotificationChannel.TELEGRAM)
  })
})
