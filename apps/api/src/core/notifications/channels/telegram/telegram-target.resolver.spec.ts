import { NotificationChannel } from '../../notification.constants'
import type { NotificationDefinition } from '../../notification-definition.types'
import type { TargetRecipient, TargetRecipientTelegram } from '../channel-target-resolver.types'

import { TelegramTerminalReason } from './telegram.constants'
import { TelegramTargetResolver } from './telegram-target.resolver'

import { TelegramConnectionStatus } from '@/generated/prisma/client'

const resolver = new TelegramTargetResolver()

const recipient = (overrides: Partial<TargetRecipient> = {}): TargetRecipient => ({
  id: 'user-1',
  email: 'alice@example.com',
  emailCanonical: 'alice@example.com',
  emailVerified: true,
  locale: 'en',
  ...overrides,
})

const connection = (overrides: Partial<TargetRecipientTelegram> = {}): TargetRecipientTelegram => ({
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
  it('declares the telegram channel', () => {
    expect(resolver.channel).toBe(NotificationChannel.TELEGRAM)
  })

  it('targets the chat with ref + redacted snapshot for an ACTIVE connection', () => {
    const [target] = resolver.resolveTargets(context(recipient({ telegram: connection() })))
    expect(target).toEqual({
      targetKey: '123456789',
      targetRef: 'conn-1',
      destinationSnapshot: { chatId: '***6789' },
    })
    expect(target?.skipReasonCode).toBeUndefined()
  })

  it('skips a BLOCKED connection with the distinct destination_unavailable reason', () => {
    const telegram = connection({ status: TelegramConnectionStatus.BLOCKED })
    const [target] = resolver.resolveTargets(context(recipient({ telegram })))
    expect(target?.skipReasonCode).toBe(TelegramTerminalReason.DESTINATION_UNAVAILABLE)
    // Still carries the ref/key so the row is observable and tied to the fenced connection.
    expect(target?.targetRef).toBe('conn-1')
    expect(target?.targetKey).toBe('123456789')
  })

  it('skips telegram_not_linked (keyed by user id) when there is no connection', () => {
    const [target] = resolver.resolveTargets(context(recipient({ telegram: null })))
    expect(target).toEqual({
      targetKey: 'user-1',
      skipReasonCode: TelegramTerminalReason.NOT_LINKED,
    })
  })

  it('treats undefined telegram facts as not linked', () => {
    const [target] = resolver.resolveTargets(context(recipient()))
    expect(target?.skipReasonCode).toBe(TelegramTerminalReason.NOT_LINKED)
  })

  it('redacts a short chat id fully', () => {
    const [target] = resolver.resolveTargets(
      context(recipient({ telegram: connection({ chatId: '99' }) }))
    )
    expect(target?.destinationSnapshot).toEqual({ chatId: '***' })
  })
})
