import type { Notification } from '@prisma/client'
import { z } from 'zod'

// Importing EmailService pulls the email template chain (@react-email/render +
// @formatjs/intl, ESM); mock them so the Jest (CommonJS) project can load this spec.
// The deliverer itself no longer uses @formatjs/intl — these only satisfy the import graph.
jest.mock('@react-email/render', () => ({ render: jest.fn(async () => '<html></html>') }))
jest.mock('@formatjs/intl', () => ({ createIntl: jest.fn(() => ({ formatMessage: jest.fn() })) }))

import type { ClaimedDelivery } from '../dispatch/notification-dispatch.types'
import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from '../notification.constants'
import { NotificationDefinitionRegistry } from '../notification-definition.registry'
import type { NotificationDefinition } from '../notification-definition.types'

import { EmailChannelDeliverer } from './email-channel.deliverer'

import type { EnvService } from '@/env/env.service'
import type { EmailService } from '@/infrastructure/email'
import { emailMessages } from '@/infrastructure/email/messages'

const base = {
  category: NotificationCategory.ACCOUNT,
  schemaVersion: 1,
  defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
  mandatoryChannels: [],
  externalModeByChannel: {},
  safePayload: (p: unknown) => p as Record<string, unknown>,
  renderInApp: () => ({ title: 'in-app', body: 'in-app' }),
} as const

const detailedDef: NotificationDefinition = {
  ...base,
  type: 'account.detail',
  contentClass: NotificationContentClass.PUBLIC, // → email detailed
  supportedChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
  payloadSchema: z.object({ v: z.string() }),
  projectExternal: () => ({}),
  renderEmail: () => ({ title: 'Detailed title', body: 'Detailed body' }),
}

const genericDef: NotificationDefinition = {
  ...base,
  type: 'account.generic',
  contentClass: NotificationContentClass.SENSITIVE, // → email generic
  supportedChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
  payloadSchema: z.object({}),
}

// Note: a SECRET definition cannot be constructed here — the registry rejects it at
// registration (ADR-052), so the deliverer's `forbidden` branch is unreachable defensive
// code and is intentionally not unit-tested.

const claim = (overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery => ({
  id: 'd1',
  notificationId: 'n1',
  channel: NotificationChannel.EMAIL,
  targetKey: 'to@example.com',
  targetRef: null,
  destinationSnapshot: null,
  locale: 'ru',
  attemptNumber: 1,
  maxAttempts: 5,
  leaseToken: 'lease',
  ...overrides,
})

const notification = (overrides: Partial<Notification> = {}): Notification =>
  ({
    id: 'n1',
    type: 'account.detail',
    payload: { v: 'x' },
    action: null,
    ...overrides,
  }) as Notification

describe('EmailChannelDeliverer', () => {
  let email: jest.Mocked<Pick<EmailService, 'renderTemplate' | 'send' | 'queue'>>
  let env: jest.Mocked<Pick<EnvService, 'get'>>

  const build = (defs: NotificationDefinition[]): EmailChannelDeliverer =>
    new EmailChannelDeliverer(
      new NotificationDefinitionRegistry(defs),
      email as unknown as EmailService,
      env as unknown as EnvService
    )

  beforeEach(() => {
    email = {
      renderTemplate: jest.fn().mockResolvedValue({ html: '<p>', text: 'p', subject: 's' }),
      send: jest.fn().mockResolvedValue({ id: 'prov-1', success: true }),
      queue: jest.fn(),
    }
    env = { get: jest.fn().mockReturnValue('https://app.example') }
  })

  it('renders detailed content + forwards the stable provider idempotency key, never queues', async () => {
    const deliverer = build([detailedDef])
    const result = await deliverer.deliver({ delivery: claim(), notification: notification() })

    expect(email.renderTemplate).toHaveBeenCalledWith(
      'notification',
      expect.objectContaining({ title: 'Detailed title', body: 'Detailed body', locale: 'ru' }),
      'worker'
    )
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'to@example.com',
        idempotencyKey: 'notification-delivery:d1',
      }),
      { template: 'notification', mode: 'worker' }
    )
    expect(email.queue).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'delivered', providerMessageId: 'prov-1' })
  })

  it('uses neutral generic content for a SENSITIVE definition (never reads the payload)', async () => {
    const deliverer = build([genericDef])
    await deliverer.deliver({
      delivery: claim(),
      notification: notification({ type: 'account.generic', payload: { secret: 'leak' } }),
    })
    expect(email.renderTemplate).toHaveBeenCalledWith(
      'notification',
      expect.objectContaining({ title: emailMessages.ru['notification.genericTitle'] }),
      'worker'
    )
  })

  it('falls back to generic content for an unregistered type', async () => {
    const deliverer = build([])
    await deliverer.deliver({
      delivery: claim(),
      notification: notification({ type: 'account.unknown' }),
    })
    expect(email.renderTemplate).toHaveBeenCalledWith(
      'notification',
      expect.objectContaining({ title: emailMessages.ru['notification.genericTitle'] }),
      'worker'
    )
  })

  it('adds a CTA to the trusted app base when the notification carries an action', async () => {
    const deliverer = build([detailedDef])
    await deliverer.deliver({
      delivery: claim(),
      notification: notification({ action: { route: 'account.settings' } as never }),
    })
    expect(email.renderTemplate).toHaveBeenCalledWith(
      'notification',
      expect.objectContaining({ actionUrl: 'https://app.example' }),
      'worker'
    )
  })

  it('permanently fails (no send) when a detailed payload is invalid', async () => {
    const deliverer = build([detailedDef])
    const result = await deliverer.deliver({
      delivery: claim(),
      notification: notification({ payload: { v: 123 } as never }),
    })
    expect(result).toEqual({ status: 'permanent', errorCode: 'email_payload_invalid' })
    expect(email.send).not.toHaveBeenCalled()
  })

  it('maps a deterministic provider failure to permanent and a transient one to transient', async () => {
    const deliverer = build([detailedDef])

    email.send.mockResolvedValueOnce({ id: '', success: false, retryable: false })
    expect(await deliverer.deliver({ delivery: claim(), notification: notification() })).toEqual({
      status: 'permanent',
      errorCode: 'email_provider_permanent',
    })

    email.send.mockResolvedValueOnce({ id: '', success: false, retryable: true })
    expect(await deliverer.deliver({ delivery: claim(), notification: notification() })).toEqual({
      status: 'transient',
      errorCode: 'email_provider_transient',
    })
  })

  it('permanently fails on a deterministic render error', async () => {
    const deliverer = build([detailedDef])
    email.renderTemplate.mockRejectedValueOnce(new Error('render boom'))
    const result = await deliverer.deliver({ delivery: claim(), notification: notification() })
    expect(result).toEqual({ status: 'permanent', errorCode: 'email_render_failed' })
  })
})
