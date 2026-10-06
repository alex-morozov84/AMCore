import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

import type { PrismaService } from '../../../../prisma'
import type { ClaimedDelivery } from '../../dispatch/notification-dispatch.types'
import { NotificationShutdownLatch } from '../../dispatch/notification-shutdown.latch'
import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from '../../notification.constants'
import { NotificationDefinitionRegistry } from '../../notification-definition.registry'
import type { NotificationDefinition } from '../../notification-definition.types'
import type { DeliveryAdmission, DeliveryContext } from '../channel-deliverer.types'

import type { TelegramBotApiClient, TelegramSendResult } from './telegram-bot-api.client'
import { TelegramChannelDeliverer } from './telegram-channel.deliverer'
import { telegramGenericMessages } from './telegram-messages'

import type { EnvService } from '@/env/env.service'
import type { Notification } from '@/generated/prisma/client'

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
  let latch: NotificationShutdownLatch
  let admissionSend: jest.Mock

  const admission: DeliveryAdmission = { send: (transport) => admissionSend(transport) }
  const deliverNow = (ctx: DeliveryContext) => deliverer.deliver(ctx, admission)

  beforeEach(() => {
    client = { sendMessage: jest.fn() }
    prisma = mockDeep<PrismaService>()
    env = { get: jest.fn().mockReturnValue('https://app.example') }
    latch = new NotificationShutdownLatch(mockDeep<PinoLogger>())
    admissionSend = jest.fn((transport: (signal: AbortSignal) => Promise<unknown>) =>
      transport(new AbortController().signal)
    )
    deliverer = new TelegramChannelDeliverer(
      new NotificationDefinitionRegistry([detailedDef, genericDef]),
      client as unknown as TelegramBotApiClient,
      prisma as unknown as PrismaService,
      env as unknown as EnvService,
      latch
    )
    // Run the fence transaction callback against the same mock client.
    prisma.$transaction.mockImplementation(((cb: (tx: PrismaService) => Promise<unknown>) =>
      cb(prisma)) as never)
    // 1st raw query = connection lock; 2nd = the cancel statement's RETURNING ids.
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'conn-1' }] as never)
      .mockResolvedValueOnce([{ id: 'd2' }] as never)
  })

  it('sends generic content to the chat and maps delivered', async () => {
    client.sendMessage.mockResolvedValue({ status: 'delivered', providerMessageId: '42' })
    const result = await deliverNow(context())
    expect(result).toEqual({ status: 'delivered', providerMessageId: '42' })
    const [arg] = client.sendMessage.mock.calls[0]!
    expect(arg.chatId).toBe('999000')
    expect(arg.text).toContain(telegramGenericMessages.ru.title)
  })

  it('renders detailed content only from the allowlisted projection (no payload leak)', async () => {
    client.sendMessage.mockResolvedValue({ status: 'delivered' })
    await deliverNow(context({}, { type: 'demo.detail', payload: { v: 'X', secret: 'topsecret' } }))
    const text = client.sendMessage.mock.calls[0]![0].text
    expect(text).toContain('Detailed X')
    expect(text).not.toContain('topsecret')
  })

  it('appends the trusted app link when the notification has a first-party action', async () => {
    client.sendMessage.mockResolvedValue({ status: 'delivered' })
    await deliverNow(context({}, { action: { route: 'account.security' } }))
    // Locale-prefixed; 'https://app.example' alone would match a bare URL too.
    expect(client.sendMessage.mock.calls[0]![0].text).toContain('https://app.example/ru')
  })

  it('passes a transient result through with its retryAfterMs floor', async () => {
    client.sendMessage.mockResolvedValue({
      status: 'transient',
      errorCode: 'telegram_rate_limited',
      retryAfterMs: 30_000,
    })
    const result = await deliverNow(context())
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

    const result = await deliverNow(context())

    expect(result).toEqual({ status: 'permanent', errorCode: 'telegram_blocked' })
    expect(prisma.telegramConnection.updateMany).toHaveBeenCalledWith({
      where: { id: 'conn-1', chatId: '999000', status: 'ACTIVE' },
      data: { status: 'BLOCKED' },
    })
    // Sibling cancel: one statement over ALL active states, EXCLUDING the initiating delivery
    // (it keeps its own permanent-failure trail), then its open attempts are closed.
    const cancelSql = prisma.$queryRaw.mock.calls[1]![0] as unknown as { values: unknown[] }
    expect(cancelSql.values).toEqual(
      expect.arrayContaining([
        'telegram_connection_blocked',
        NotificationChannel.TELEGRAM,
        'conn-1',
        'd1',
      ])
    )
    expect(prisma.notificationDeliveryAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deliveryId: { in: ['d2'] }, outcome: null },
        data: expect.objectContaining({ outcome: 'ABANDONED', errorCode: 'delivery_cancelled' }),
      })
    )
  })

  it('fence does nothing once the shutdown latch is sealed (late permanent result)', async () => {
    client.sendMessage.mockResolvedValue({ status: 'permanent', errorCode: 'telegram_blocked' })
    latch.seal()
    const result = await deliverNow(context())
    expect(result).toEqual({ status: 'permanent', errorCode: 'telegram_blocked' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('returns not_started and makes NO Bot API call when admission refuses', async () => {
    admissionSend.mockResolvedValue({ status: 'not_started', reason: 'aborted' })
    const result = await deliverNow(context())
    expect(result).toEqual({ status: 'not_started', reason: 'aborted' })
    expect(client.sendMessage).not.toHaveBeenCalled()
  })

  it('forwards the attempt abort signal to the Bot API client', async () => {
    client.sendMessage.mockResolvedValue({ status: 'delivered' })
    await deliverNow(context())
    expect(client.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  describe('checkTarget (actual-start admission, under FOR SHARE)', () => {
    const check = (
      row: Record<string, unknown> | undefined,
      overrides: Partial<ClaimedDelivery> = {}
    ) => {
      prisma.$queryRaw.mockReset()
      prisma.$queryRaw.mockResolvedValue((row ? [row] : []) as never)
      return deliverer.checkTarget(
        prisma as never,
        context(overrides, { recipientUserId: 'user-1' })
      )
    }
    const active = { userId: 'user-1', chatId: '999000', status: 'ACTIVE' }

    it('accepts an ACTIVE connection of the same recipient and chat', async () => {
      expect(await check(active)).toBeNull()
    })

    it.each([
      ['an absent / replaced generation', undefined, {}],
      ['a null targetRef', active, { targetRef: null }],
      ['another recipient', { ...active, userId: 'someone-else' }, {}],
      ['another chat', { ...active, chatId: '111' }, {}],
    ])('refuses %s as telegram_target_revoked', async (_label, row, overrides) => {
      expect(await check(row, overrides as Partial<ClaimedDelivery>)).toEqual({
        reason: 'telegram_target_revoked',
      })
    })

    it('refuses a BLOCKED connection as telegram_connection_blocked', async () => {
      expect(await check({ ...active, status: 'BLOCKED' })).toEqual({
        reason: 'telegram_connection_blocked',
      })
    })
  })

  it('does NOT fence on a non-destination permanent (provider/config error)', async () => {
    client.sendMessage.mockResolvedValue({
      status: 'permanent',
      errorCode: 'telegram_provider_permanent',
    })
    const result = await deliverNow(context())
    expect(result).toEqual({ status: 'permanent', errorCode: 'telegram_provider_permanent' })
    expect(prisma.telegramConnection.updateMany).not.toHaveBeenCalled()
  })

  it('does not cancel deliveries when the conditional block matches no row (generation fence)', async () => {
    client.sendMessage.mockResolvedValue({
      status: 'permanent',
      errorCode: 'telegram_chat_not_found',
    })
    prisma.telegramConnection.updateMany.mockResolvedValue({ count: 0 })

    await deliverNow(context())

    expect(prisma.notificationDelivery.updateMany).not.toHaveBeenCalled()
  })

  it('declares the telegram channel', () => {
    expect(deliverer.channel).toBe(NotificationChannel.TELEGRAM)
  })
})
