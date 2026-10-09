import { NotificationChannel } from '../../notification.constants'
import type { NotificationDefinition } from '../../notification-definition.types'
import type { TargetRecipient } from '../channel-target-resolver.types'

import { TelegramTerminalReason } from './telegram.constants'
import { TelegramTargetResolver } from './telegram-target.resolver'

import { type Prisma, TelegramConnectionStatus } from '@/generated/prisma/client'

interface Connection {
  connectionId: string
  chatId: string
  status: TelegramConnectionStatus
}
const tx = (value: Connection | null = null): Prisma.TransactionClient =>
  ({
    $queryRaw: jest
      .fn()
      .mockResolvedValue(
        value ? [{ id: value.connectionId, chatId: value.chatId, status: value.status }] : []
      ),
  }) as unknown as Prisma.TransactionClient

const resolver = new TelegramTargetResolver()

const recipient = (overrides: Partial<TargetRecipient> = {}): TargetRecipient => ({
  id: 'user-1',
  email: 'alice@example.com',
  emailCanonical: 'alice@example.com',
  emailVerified: true,
  locale: 'en',
  ...overrides,
})

const connection = (overrides: Partial<Connection> = {}): Connection => ({
  connectionId: 'conn-1',
  chatId: '123456789',
  status: TelegramConnectionStatus.ACTIVE,
  ...overrides,
})

const context = (r: TargetRecipient) => ({
  recipient: r,
  definition: {} as NotificationDefinition,
  payload: {},
  locale: r.locale,
})

describe('TelegramTargetResolver', () => {
  it('declares the telegram channel', async () => {
    expect(resolver.channel).toBe(NotificationChannel.TELEGRAM)
  })

  it('targets the chat with ref + redacted snapshot for an ACTIVE connection', async () => {
    const [target] = await resolver.resolveTargets(tx(connection()), context(recipient()))
    expect(target).toEqual({
      targetKey: '123456789',
      targetRef: 'conn-1',
      destinationSnapshot: { chatId: '***6789' },
    })
    expect(target?.skipReasonCode).toBeUndefined()
  })

  it('skips a BLOCKED connection with the distinct destination_unavailable reason', async () => {
    const telegram = connection({ status: TelegramConnectionStatus.BLOCKED })
    const [target] = await resolver.resolveTargets(tx(telegram), context(recipient()))
    expect(target?.skipReasonCode).toBe(TelegramTerminalReason.DESTINATION_UNAVAILABLE)
    // Still carries the ref/key so the row is observable and tied to the fenced connection.
    expect(target?.targetRef).toBe('conn-1')
    expect(target?.targetKey).toBe('123456789')
  })

  it('skips telegram_not_linked (keyed by user id) when there is no connection', async () => {
    const [target] = await resolver.resolveTargets(tx(), context(recipient()))
    expect(target).toEqual({
      targetKey: 'user-1',
      skipReasonCode: TelegramTerminalReason.NOT_LINKED,
    })
  })

  it('treats undefined telegram facts as not linked', async () => {
    const [target] = await resolver.resolveTargets(tx(), context(recipient()))
    expect(target?.skipReasonCode).toBe(TelegramTerminalReason.NOT_LINKED)
  })

  it('redacts a short chat id fully', async () => {
    const [target] = await resolver.resolveTargets(
      tx(connection({ chatId: '99' })),
      context(recipient())
    )
    expect(target?.destinationSnapshot).toEqual({ chatId: '***' })
  })
})
