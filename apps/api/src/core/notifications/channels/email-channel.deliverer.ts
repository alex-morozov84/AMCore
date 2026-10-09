import { Injectable } from '@nestjs/common'

import { coerceSupportedLocale, localizedFrontendUrl, type SupportedLocale } from '@amcore/shared'

import { NotificationPreparedRequestService } from '../dispatch/notification-prepared-request.service'
import { NotificationChannel } from '../notification.constants'
import { resolveExternalMode } from '../notification-content-policy'
import { NotificationDefinitionRegistry } from '../notification-definition.registry'
import type { RenderedNotificationContent } from '../notification-definition.types'

import {
  type ChannelDeliverer,
  type DeliveryAdmission,
  type DeliveryContext,
  type DeliveryResult,
  isNotStarted,
  type NotStarted,
} from './channel-deliverer.types'
import {
  NotificationPreparationError,
  type PreparedNotificationRequest,
  preparedNotificationRequest,
} from './notification-prepared-request'

import { EnvService } from '@/env/env.service'
import { EmailService, EmailTemplate } from '@/infrastructure/email'
import { emailMessages } from '@/infrastructure/email/messages'
import { serializeNotificationEmail } from '@/infrastructure/email/prepared-email'

/** Bounded email-channel error codes (attempt `errorCode` / terminal reason). */
const EmailDeliveryError = {
  CONTENT_FORBIDDEN: 'email_content_forbidden',
  PAYLOAD_INVALID: 'email_payload_invalid',
  RENDER_FAILED: 'email_render_failed',
  PROVIDER_PERMANENT: 'email_provider_permanent',
  PROVIDER_TRANSIENT: 'email_provider_transient',
} as const

/**
 * Email channel deliverer (ADR-052, worker-only). Renders the generic notification email
 * — detailed via the definition's `renderExternal.email` only when the content policy allows it,
 * otherwise a neutral summary that never touches the raw payload — and sends it via
 * `EmailService.sendPreparedNotification()` with a frozen body and stable provider idempotency key
 * (`notification-delivery:<id>`), which mitigates the at-least-once duplicate-send risk
 * (abort is best-effort and cannot recall an accepted provider request). It NEVER uses
 * `EmailService.queue()` — a notification email must not enter the EMAIL queue.
 */
@Injectable()
export class EmailChannelDeliverer implements ChannelDeliverer {
  readonly channel = NotificationChannel.EMAIL

  constructor(
    private readonly registry: NotificationDefinitionRegistry,
    private readonly email: EmailService,
    private readonly env: EnvService,
    private readonly prepared: NotificationPreparedRequestService
  ) {}

  async deliver(
    context: DeliveryContext,
    admission: DeliveryAdmission
  ): Promise<DeliveryResult | NotStarted> {
    try {
      this.registry.getStored(context.notification.type, context.notification.schemaVersion)
    } catch {
      return { status: 'permanent', errorCode: 'notification_version_unavailable' }
    }
    const key = `notification-delivery:${context.delivery.id}`
    const binding = `${this.env.get('EMAIL_PROVIDER')}:default:https://api.resend.com`
    const request = await this.prepared.obtain(context, this, binding, '/emails', key, () =>
      this.prepare(context, binding, key)
    )
    if ('status' in request) return request
    const result = await admission.send((signal) =>
      this.email.sendPreparedNotification(request.body, key, signal)
    )
    if (isNotStarted(result)) return result

    if (result.success) {
      return { status: 'delivered', providerMessageId: result.id }
    }
    if (result.retryable === false) {
      return { status: 'permanent', errorCode: EmailDeliveryError.PROVIDER_PERMANENT }
    }
    // A transport that exposes a retry delay (Resend's `Retry-After` on a rate limit) becomes a
    // retry floor; one that does not simply keeps the ordinary backoff.
    return {
      status: 'transient',
      errorCode: EmailDeliveryError.PROVIDER_TRANSIENT,
      ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
    }
  }

  private async prepare(
    context: DeliveryContext,
    binding: string,
    key: string
  ): Promise<PreparedNotificationRequest> {
    const { delivery, notification } = context
    const locale = coerceSupportedLocale(delivery.locale)

    const content = this.resolveContent(
      notification.type,
      notification.schemaVersion,
      notification.payload,
      locale
    )
    if (content === 'version_unavailable') {
      throw new NotificationPreparationError('notification_version_unavailable')
    }
    if (content === 'forbidden') {
      throw new NotificationPreparationError(EmailDeliveryError.CONTENT_FORBIDDEN)
    }
    if (content === 'payload_invalid') {
      throw new NotificationPreparationError(EmailDeliveryError.PAYLOAD_INVALID)
    }

    // A first-party action (stored on the notification) → CTA to the trusted app base,
    // never an arbitrary URL.
    const actionUrl =
      notification.action !== null && notification.action !== undefined
        ? localizedFrontendUrl(this.env.get('FRONTEND_URL'), locale)
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
      throw new NotificationPreparationError(EmailDeliveryError.RENDER_FAILED)
    }

    const body = serializeNotificationEmail({
      from: this.env.get('EMAIL_FROM'),
      to: delivery.targetKey,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
    return preparedNotificationRequest(context, binding, '/emails', body, key)
  }

  /**
   * Build the localized email content, or a sentinel for a terminal condition. Detailed
   * content renders ONLY from the `projectExternal('email', …)` allowlisted projection
   * (the enforced external data boundary — ADR-052), never the raw payload; everything
   * else (generic mode, or a detailed definition missing the projection/renderer) gets a
   * neutral generic body that never touches the payload.
   */
  private resolveContent(
    type: string,
    schemaVersion: number,
    payload: unknown,
    locale: SupportedLocale
  ): RenderedNotificationContent | 'forbidden' | 'payload_invalid' | 'version_unavailable' {
    let definition
    try {
      definition = this.registry.getStored(type, schemaVersion)
    } catch {
      return 'version_unavailable'
    }
    const decoded = definition.payloadSchema.safeParse(payload)
    if (!decoded.success) return 'payload_invalid'
    const mode = resolveExternalMode(definition, NotificationChannel.EMAIL)
    if (mode === 'forbidden') return 'forbidden'

    if (mode === 'detailed' && definition.renderExternal?.email && definition.projectExternal) {
      const parsed = definition.payloadSchema.safeParse(payload)
      if (!parsed.success) return 'payload_invalid'
      // The allowlisted projection is the only data the email renderer may see.
      const projection = definition.projectExternal(NotificationChannel.EMAIL, parsed.data)
      return definition.renderExternal?.email(projection, locale)
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
