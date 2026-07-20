import { z } from 'zod'

// Bull Board queue dashboard toggles. NOTE: the mount gate in queue.module.ts
// reads these from `process.env` at module-import time, BEFORE ConfigModule loads
// the .env file. These entries validate/type the flags for app code, but to enable
// the dashboard in production you must set ENABLE_BULL_BOARD as a real process env
// var, not via the .env file. See `.env.example` and `bull-board-mount-gate.ts`.
// Enum-transform rather than z.coerce.boolean() — the latter treats 'false' as true.
export const queueEnv = z.object({
  // Disabled in production unless explicitly enabled (EQS-01: zero default attack
  // surface). In non-production it is mounted but still protected by SUPER_ADMIN
  // cookie auth.
  ENABLE_BULL_BOARD: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Read-only mode (ADR-047). Secure default `true`: the dashboard renders
  // read-only; set `false` only to allow write actions (retry / promote / clean /
  // remove jobs).
  BULL_BOARD_READ_ONLY: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
})
