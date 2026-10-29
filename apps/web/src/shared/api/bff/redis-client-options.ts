import { createClient } from '@redis/client'

import 'server-only'

/**
 * Longest an ordinary command may wait in the client's queue before it is written. It covers
 * reconnect backoff and write backpressure. It never bounds connecting, a command that is already
 * written, or the whole request; the BFF keeps its own caller deadlines.
 */
export const REDIS_QUEUE_TIMEOUT_MS = 5000

/** Delay before the first TCP keepalive probe on an idle connection. */
export const REDIS_KEEPALIVE_INITIAL_DELAY_MS = 5000

/**
 * The one place that fixes the BFF client contract. RESP 2 is explicit: version 6 defaults to
 * RESP 3 and would send `HELLO 3` and enable maintenance notifications. There is deliberately no
 * `socketTimeout`.
 */
export function redisClientOptions(url: string) {
  return {
    url,
    RESP: 2 as const,
    commandOptions: { timeout: REDIS_QUEUE_TIMEOUT_MS },
    socket: {
      reconnectStrategy: (retries: number): number => Math.min(retries * 50, 2000),
      keepAliveInitialDelay: REDIS_KEEPALIVE_INITIAL_DELAY_MS,
    },
  }
}

export function createBffRedisClient(url: string) {
  return createClient(redisClientOptions(url))
}
