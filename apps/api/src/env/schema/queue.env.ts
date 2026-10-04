import { z } from 'zod'

// Bull Board queue dashboard toggle. NOTE: the mount decision (`BULL_BOARD_MOUNT`) reads
// ENABLE_BULL_BOARD from `process.env` at module-import time, BEFORE ConfigModule loads
// the .env file. This entry validates/types the flag for app code, but to enable the
// dashboard in production you must set ENABLE_BULL_BOARD as a real process env var, not
// via the .env file. See `.env.example` and `dashboard/bull-board-mount-state.ts`.
// The dashboard is always read-only; the retired BULL_BOARD_READ_ONLY variable is ignored.
// Enum-transform rather than z.coerce.boolean() — the latter treats 'false' as true.
export const queueEnv = z.object({
  // Disabled in production unless explicitly enabled (EQS-01: zero default attack
  // surface). In non-production it is mounted but still protected by SUPER_ADMIN auth.
  ENABLE_BULL_BOARD: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})
