import { z } from 'zod'

import { resolveTrustProxy } from '../../common/utils/trust-proxy'

// Core runtime/process wiring: environment, process role, HTTP surface.
export const runtimeEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Process role (ADR-041): `web` serves HTTP + enqueues; `worker` runs BullMQ
  // processors + cron with health-only HTTP; `all` is both (dev/single-node).
  // The bootstrap reads this raw to pick the root module; this validates it.
  PROCESS_ROLE: z.enum(['web', 'worker', 'all']).default('all'),
  // Worker concurrency for BullMQ processors (ADR-041). Default 1 (BullMQ's
  // default); tune from ~floor(cpu/2) for I/O-bound jobs.
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(1),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(5002),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3002')
    .transform((s) => s.split(',').map((x) => x.trim())),
  // Express `trust proxy` (proxy awareness). Default `false` — `req.ip` is the socket
  // peer and `X-Forwarded-*` is not trusted. Set it to the real proxy topology behind
  // a reverse proxy/LB so `req.ip` is the true client. Validated + mapped to Express's
  // value by `resolveTrustProxy` (see common/utils/trust-proxy.ts).
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((value, ctx) => {
      try {
        return resolveTrustProxy(value)
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message })
        return z.NEVER
      }
    }),
})
