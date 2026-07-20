import { z } from 'zod'

// HTTP idempotency primitive (see docs/operations/idempotency.md).
export const idempotencyEnv = z.object({
  IDEMPOTENCY_RETENTION_SECONDS: z.coerce.number().int().min(1).default(86400),
  IDEMPOTENCY_LOCK_TTL_SECONDS: z.coerce.number().int().min(1).default(30),
  IDEMPOTENCY_FAIL_MODE: z.enum(['open', 'closed']).default('open'),
  IDEMPOTENCY_REDIS_TIMEOUT_MS: z.coerce.number().int().min(1).default(100),
})
