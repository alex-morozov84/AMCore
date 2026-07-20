import { z } from 'zod'

// Postgres connection + pool/timeout tuning. `DATABASE_URL` is one of the three
// unconditionally-required keys; the production `sslmode` rule lives in the
// composed cross-field refinement (it depends on NODE_ENV).
export const databaseEnv = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  DATABASE_POOL_IDLE_MS: z.coerce.number().int().min(0).default(30000),
  DATABASE_CONNECT_MS: z.coerce.number().int().min(0).default(5000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
  DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
  DATABASE_POOL_WAITING_THRESHOLD: z.coerce.number().int().min(0).default(5),
  // Env-derived default resolved in the composed transform (production → 500, else 100).
  SLOW_QUERY_THRESHOLD_MS: z.coerce.number().int().min(0).optional(),
})
