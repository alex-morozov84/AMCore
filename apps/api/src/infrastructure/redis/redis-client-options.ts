import { createClient, type RedisClientType } from '@redis/client'

/**
 * Longest an ordinary command may wait in the client's queue before it is written. It covers
 * reconnect backoff and write backpressure. It never bounds connecting, a command that is already
 * written, MULTI/pipeline batches or the whole HTTP request; callers keep their own shorter limits,
 * because a local option overrides this base value.
 */
export const REDIS_QUEUE_TIMEOUT_MS = 5000

/** Delay before the first TCP keepalive probe on an idle connection. */
export const REDIS_KEEPALIVE_INITIAL_DELAY_MS = 5000

export interface AppRedisClientOptions {
  url: string
  RESP: 2
  commandOptions: { timeout: number }
  socket: {
    reconnectStrategy: ((retries: number) => number) | false
    keepAliveInitialDelay: number
  }
}

/** The shared client: explicit RESP 2, no modules. */
export type AppRedisClient = RedisClientType<
  Record<never, never>,
  Record<never, never>,
  Record<never, never>,
  2
>

/**
 * The one place that fixes the production client contract. RESP 2 is explicit: version 6 defaults
 * to RESP 3 and would send `HELLO 3` and enable maintenance notifications. There is deliberately no
 * `socketTimeout`: it would disconnect idle subscriber connections that duplicate this client.
 */
export function redisClientOptions(url: string): AppRedisClientOptions {
  return {
    url,
    RESP: 2,
    commandOptions: { timeout: REDIS_QUEUE_TIMEOUT_MS },
    socket: {
      reconnectStrategy: (retries: number): number => Math.min(retries * 50, 2000),
      keepAliveInitialDelay: REDIS_KEEPALIVE_INITIAL_DELAY_MS,
    },
  }
}

export function createAppRedisClient(url: string): AppRedisClient {
  return createClient(redisClientOptions(url))
}
