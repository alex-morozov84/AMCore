import { z } from 'zod'

// Inbound webhook verification. `WEBHOOK_SECRETS` is a synthetic aggregate: it is
// never set directly, but populated by the composed preprocess from dynamic
// `WEBHOOK_<PROVIDER>_SECRET` env vars (see refinements.ts → collectWebhookSecrets).
export const webhooksEnv = z.object({
  WEBHOOK_SECRETS: z.record(z.string(), z.string()).default({}),
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: z.coerce.number().int().min(1).default(300),
  // Env-derived default resolved in the composed transform (falls back to the tolerance).
  WEBHOOK_REPLAY_DEDUPE_TTL_SECONDS: z.coerce.number().int().min(1).optional(),
})
