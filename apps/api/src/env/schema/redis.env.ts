import { z } from 'zod'

// Redis connection (BullMQ, cache, rate-limit, realtime pub/sub).
export const redisEnv = z.object({
  REDIS_URL: z.url(),
})
