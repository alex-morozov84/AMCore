import { z } from 'zod'

import type { DeliveryContext } from './channel-deliverer.types'
import type { NotificationChannelDescriptor } from './notification-channel.types'

import { canonicalJsonHash } from '@/common/utils/canonical-json'
import { strictJson } from '@/common/utils/strict-json'

const envelopeSchema = z
  .object({
    formatVersion: z.literal(1),
    wireVersion: z.literal(1),
    deliveryId: z.string().min(1),
    channel: z.string().min(1),
    type: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    targetKey: z.string().min(1),
    targetRef: z.string().nullable(),
    binding: z.string().min(1).max(1024),
    idempotencyKey: z.string().max(255).nullable(),
    method: z.literal('POST'),
    path: z.string().max(64),
    body: z.string(),
  })
  .strict()

export type PreparedNotificationRequest = z.infer<typeof envelopeSchema>
export const PREPARED_REQUEST_MAX_BYTES = 128 * 1024

export function preparedNotificationRequest(
  context: DeliveryContext,
  binding: string,
  path: string,
  body: string,
  idempotencyKey: string | null
): PreparedNotificationRequest {
  const { delivery, notification } = context
  return {
    formatVersion: 1,
    wireVersion: 1,
    deliveryId: delivery.id,
    channel: delivery.channel,
    type: notification.type,
    schemaVersion: notification.schemaVersion,
    targetKey: delivery.targetKey,
    targetRef: delivery.targetRef,
    binding,
    idempotencyKey,
    method: 'POST',
    path,
    body,
  }
}

/** Binding is checked against canonical work, never just a self-consistent checksum. */
export function validatePreparedRequest(
  value: unknown,
  context: DeliveryContext,
  descriptor: NotificationChannelDescriptor,
  binding: string,
  expectedPath: string,
  expectedKey: string | null
): { request: PreparedNotificationRequest; hash: string } {
  strictJson(value, PREPARED_REQUEST_MAX_BYTES)
  const request = envelopeSchema.parse(value)
  const { delivery, notification } = context
  if (
    request.deliveryId !== delivery.id ||
    request.channel !== descriptor.id ||
    request.channel !== delivery.channel ||
    request.type !== notification.type ||
    request.schemaVersion !== notification.schemaVersion ||
    request.targetKey !== delivery.targetKey ||
    request.targetRef !== delivery.targetRef ||
    request.binding !== binding ||
    request.wireVersion !== descriptor.wireVersion ||
    request.path !== expectedPath ||
    request.idempotencyKey !== expectedKey
  )
    throw new Error('prepared_request_binding_mismatch')
  const body: unknown = JSON.parse(request.body)
  strictJson(body, PREPARED_REQUEST_MAX_BYTES)
  descriptor.requestSchema.parse(body)
  if (!descriptor.requestTargetsDelivery(body, context))
    throw new Error('prepared_request_target_mismatch')
  return { request, hash: canonicalJsonHash(request) }
}

/** Only code-owned preparation verdicts may become persisted diagnostic codes. */
export class NotificationPreparationError extends Error {
  constructor(
    readonly code:
      | 'notification_version_unavailable'
      | 'email_content_forbidden'
      | 'email_payload_invalid'
      | 'email_render_failed'
      | 'telegram_content_forbidden'
      | 'telegram_payload_invalid'
      | 'telegram_render_failed'
  ) {
    super(code)
  }
}
