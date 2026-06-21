import { z } from 'zod'

import { accountPasswordChangedDefinition } from '../../definitions/account-password-changed.definition'
import {
  NotificationCategory,
  NotificationChannel,
  NotificationContentClass,
} from '../../notification.constants'
import { resolveExternalMode } from '../../notification-content-policy'
import type { NotificationDefinition } from '../../notification-definition.types'
import { validateDefinition } from '../../notification-definition.validation'

/**
 * A PUBLIC fixture that opts into **detailed** Telegram, exercising the
 * `projectExternal('telegram')` + `renderTelegram` seam (D.4). It proves the channel stays
 * additive for a future PUBLIC/PERSONAL definition while the shipped SENSITIVE
 * `account.password_changed` still resolves to generic, plain text.
 */
const publicTelegramDefinition: NotificationDefinition<{ orderId: string; secretField: string }> = {
  type: 'demo.telegram_detailed',
  category: NotificationCategory.PRODUCT,
  schemaVersion: 1,
  contentClass: NotificationContentClass.PUBLIC,
  supportedChannels: [NotificationChannel.IN_APP, NotificationChannel.TELEGRAM],
  defaultChannels: [NotificationChannel.IN_APP],
  mandatoryChannels: [],
  externalModeByChannel: {},
  payloadSchema: z.object({ orderId: z.string(), secretField: z.string() }),
  safePayload: (payload) => ({ orderId: payload.orderId }),
  renderInApp: () => ({ title: 'in-app', body: 'in-app' }),
  // Allowlist: only orderId crosses to Telegram — secretField never does.
  projectExternal: (_channel, payload) => ({ orderId: payload.orderId }),
  renderTelegram: (projection, locale) => ({
    title: `Order ${String(projection.orderId)}`,
    body: `(${locale})`,
  }),
}

describe('Telegram content seam (D.4)', () => {
  it('keeps the shipped SENSITIVE account.password_changed generic on Telegram', () => {
    expect(
      resolveExternalMode(accountPasswordChangedDefinition, NotificationChannel.TELEGRAM)
    ).toBe('generic')
  })

  it('resolves a PUBLIC definition to detailed on Telegram', () => {
    expect(resolveExternalMode(publicTelegramDefinition, NotificationChannel.TELEGRAM)).toBe(
      'detailed'
    )
  })

  it('renders detailed content only from the allowlisted projection (no raw payload leak)', () => {
    const payload = { orderId: 'A-100', secretField: 'top-secret' }
    const projection = publicTelegramDefinition.projectExternal!(
      NotificationChannel.TELEGRAM,
      payload
    )
    expect(projection).toEqual({ orderId: 'A-100' })
    expect(projection).not.toHaveProperty('secretField')

    const content = publicTelegramDefinition.renderTelegram!(projection, 'en')
    expect(content).toEqual({ title: 'Order A-100', body: '(en)' })
  })

  it('validates that a supported detailed Telegram channel requires projectExternal', () => {
    expect(() => validateDefinition(publicTelegramDefinition)).not.toThrow()
    const missingProjection: NotificationDefinition = {
      ...publicTelegramDefinition,
      projectExternal: undefined,
    }
    expect(() => validateDefinition(missingProjection)).toThrow()
  })
})
