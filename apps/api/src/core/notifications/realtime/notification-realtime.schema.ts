import { z } from 'zod'

import { notificationSseEventSchema } from '@amcore/shared'

/**
 * Internal Redis Pub/Sub envelope (ADR-053). This is NOT a client API, so it lives
 * in `apps/api` and never in `packages/shared`. It is built by **extending the
 * public hint schema** so the shared fields (`eventId`/`reason`/`notificationId`
 * bounds + the reason set) can never drift from the public contract. It adds the
 * routing `recipientUserId` (a CUID — trusted-Redis routing metadata only; never in
 * public SSE `data`, normal-level logs, or metric labels) and a `v` discriminator.
 * `.strict()` plus the byte guard at the read boundary
 * (`NOTIFICATION_REALTIME_ENVELOPE_MAX_BYTES`) reject anything unexpected, so a
 * malformed message is dropped rather than routed.
 */
export const notificationRealtimeEnvelopeSchema = notificationSseEventSchema
  .extend({
    v: z.literal(1),
    recipientUserId: z.string().min(1).max(64),
  })
  .strict()

export type NotificationRealtimeEnvelope = z.infer<typeof notificationRealtimeEnvelopeSchema>
