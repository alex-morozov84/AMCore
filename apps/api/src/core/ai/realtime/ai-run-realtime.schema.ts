import { z } from 'zod'

import { aiRunSseEventSchema } from '@amcore/shared'

/**
 * Internal Redis Pub/Sub envelope for AI run-status hints (Track C — ADR-054, Arc C.5; ADR-053
 * pattern). This is NOT a client API, so it lives in `apps/api`, never in `packages/shared`. It is
 * built by **extending the public hint schema** (`aiRunSseEventSchema`) so the client-visible fields
 * (`eventId`/`runId`/`status`/`reason`) can never drift from the public contract. It adds the
 * routing `recipientUserId` (a CUID — trusted-Redis routing metadata only; never in public SSE
 * `data`, normal-level logs, or metric labels) and a `v` discriminator. `.strict()` plus the byte
 * guard at the read boundary (`AI_RUN_REALTIME_ENVELOPE_MAX_BYTES`) reject anything unexpected, so a
 * malformed message is dropped rather than routed.
 */
export const aiRunRealtimeEnvelopeSchema = aiRunSseEventSchema
  .extend({
    v: z.literal(1),
    recipientUserId: z.string().min(1).max(64),
  })
  .strict()

export type AiRunRealtimeEnvelope = z.infer<typeof aiRunRealtimeEnvelopeSchema>
