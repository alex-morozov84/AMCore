import { Injectable } from '@nestjs/common'

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '@amcore/shared'

import { NotificationChannel } from '../notification.constants'
import { resolveExternalMode } from '../notification-content-policy'
import { NotificationDefinitionRegistry } from '../notification-definition.registry'
import type { RenderedNotificationContent } from '../notification-definition.types'

import type { ChannelDeliverer, DeliveryContext, DeliveryResult } from './channel-deliverer.types'

import { EnvService } from '@/env/env.service'
import { EmailService, EmailTemplate } from '@/infrastructure/email'
import { emailMessages } from '@/infrastructure/email/messages'

/** Bounded email-channel error codes (attempt `errorCode` / terminal reason). */
const EmailDeliveryError = {
  CONTENT_FORBIDDEN: 'email_content_forbidden',
  PAYLOAD_INVALID: 'email_payload_invalid',
  RENDER_FAILED: 'email_render_failed',
  PROVIDER_PERMANENT: 'email_provider_permanent',
  PROVIDER_TRANSIENT: 'email_provider_transient',
} as const

function toLocale(value: string): SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as SupportedLocale)
    : DEFAULT_LOCALE
}

/**
 * Email channel deliverer (ADR-052, worker-only). Renders the generic notification email
 * — detailed via the definition's `renderEmail` only when the content policy allows it,
 * otherwise a neutral summary that never touches the raw payload — and sends it via
 * `EmailService.send()` with a stable provider idempotency key
 * (`notification-delivery:<id>`), which mitigates the at-least-once duplicate-send risk
 * (the dispatcher's timeout does not abort an in-flight provider call). It NEVER uses
 * `EmailService.queue()` — a notification email must not enter the EMAIL queue.
 */
@Injectable()
export class EmailChannelDeliverer implements ChannelDeliverer {
  readonly channel = NotificationChannel.EMAIL

  constructor(
    private readonly registry: NotificationDefinitionRegistry,
    private readonly email: EmailService,
    private readonly env: EnvService
  ) {}

  async deliver(context: DeliveryContext): Promise<DeliveryResult> {
    const { delivery, notification } = context
    const locale = toLocale(delivery.locale)

    const content = this.resolveContent(notification.type, notification.payload, locale)
    if (content === 'forbidden') {
      return { status: 'permanent', errorCode: EmailDeliveryError.CONTENT_FORBIDDEN }
    }
    if (content === 'payload_invalid') {
      return { status: 'permanent', errorCode: EmailDeliveryError.PAYLOAD_INVALID }
    }

    // A first-party action (stored on the notification) → CTA to the trusted app base,
    // never an arbitrary URL.
    const actionUrl =
      notification.action !== null && notification.action !== undefined
        ? this.env.get('FRONTEND_URL')
        : undefined

    let rendered: { html: string; text: string; subject: string }
    try {
      rendered = await this.email.renderTemplate(
        EmailTemplate.NOTIFICATION,
        { title: content.title, body: content.body, actionUrl, locale },
        'worker'
      )
    } catch {
      // Deterministic — will not heal on retry.
      return { status: 'permanent', errorCode: EmailDeliveryError.RENDER_FAILED }
    }

    const result = await this.email.send(
      {
        to: delivery.targetKey,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: `notification-delivery:${delivery.id}`,
      },
      { template: 'notification', mode: 'worker' }
    )

    if (result.success) {
      return { status: 'delivered', providerMessageId: result.id }
    }
    return result.retryable === false
      ? { status: 'permanent', errorCode: EmailDeliveryError.PROVIDER_PERMANENT }
      : { status: 'transient', errorCode: EmailDeliveryError.PROVIDER_TRANSIENT }
  }

  /**
   * Build the localized email content, or a sentinel for a terminal condition. Detailed
   * content (definition `renderEmail`) is used only when the policy resolves email to
   * `detailed`; everything else gets a neutral generic body that never reads the payload.
   */
  private resolveContent(
    type: string,
    payload: unknown,
    locale: SupportedLocale
  ): RenderedNotificationContent | 'forbidden' | 'payload_invalid' {
    if (!this.registry.has(type)) return this.genericContent(locale)

    const definition = this.registry.get(type)
    const mode = resolveExternalMode(definition, NotificationChannel.EMAIL)
    if (mode === 'forbidden') return 'forbidden'

    if (mode === 'detailed' && definition.renderEmail) {
      const parsed = definition.payloadSchema.safeParse(payload)
      if (!parsed.success) return 'payload_invalid'
      return definition.renderEmail(parsed.data, locale)
    }
    return this.genericContent(locale)
  }

  private genericContent(locale: SupportedLocale): RenderedNotificationContent {
    // These strings have no ICU interpolation, so index the message catalog directly —
    // avoids pulling the ESM `@formatjs/intl` into this worker service.
    const messages = emailMessages[locale]
    return {
      title: messages['notification.genericTitle'],
      body: messages['notification.genericBody'],
    }
  }
}
