import { notificationActionSchema } from '@amcore/shared'

import type { NotificationDefinition } from './notification-definition.types'
import { notificationFingerprint } from './notification-fingerprint'
import type { NotifyInput } from './notifications.service'

/** Retained normalization is part of the occurrence contract, including replay. */
export function notificationIntent(
  definition: NotificationDefinition,
  input: NotifyInput
): {
  payload: unknown
  action: ReturnType<typeof notificationActionSchema.parse> | null
  fingerprint: string
} {
  const payload = definition.payloadSchema.parse(input.payload)
  const rawAction = definition.action?.(payload) ?? null
  const action = rawAction ? notificationActionSchema.parse(rawAction) : null
  const fingerprint = notificationFingerprint({
    type: input.type,
    category: definition.category,
    schemaVersion: definition.schemaVersion,
    payload,
    action,
    organizationId: input.organizationId ?? null,
    occurredAt: input.occurredAt?.toISOString() ?? null,
  })
  return { payload, action, fingerprint }
}
