import { z } from 'zod'

// JWT sessions, step-up recent-auth window, and RBAC ACL-version cache.
export const authEnv = z.object({
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRATION: z.string().default('15m'),
  JWT_REFRESH_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  // OB-06b / ADR-037: step-up recent-auth window (seconds). Destructive admin ops
  // require the session to have been (re)authenticated within this window.
  STEP_UP_MAX_AGE_SECONDS: z.coerce.number().int().min(1).default(600),
  RBAC_ACLV_CACHE_TTL_MS: z.coerce.number().int().min(0).default(0),
})
