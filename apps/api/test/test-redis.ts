import { createClient, type RedisClientType } from '@redis/client'
import type { StartedRedisContainer } from '@testcontainers/redis'

import {
  type AppRedisClientOptions,
  redisClientOptions,
} from '../src/infrastructure/redis/redis-client-options'

/** An explicit RESP 2 client without modules: the protocol production pins. */
export type RedisConnection = RedisClientType<
  Record<never, never>,
  Record<never, never>,
  Record<never, never>,
  2
>
const open = (url: string): RedisConnection => createClient({ url, RESP: 2 })

/**
 * Connection owned by one E2E context and built from that context's own Testcontainers
 * Redis. `flush()` empties only that container's database for per-test cleanup. It is a
 * test fixture: it never uses the application's Redis provider and nothing in
 * production code can reach it.
 */
export class TestRedis {
  private constructor(private readonly client: RedisConnection) {}

  static async connect(container: StartedRedisContainer): Promise<TestRedis> {
    const client = open(container.getConnectionUrl())
    client.on('error', () => undefined)
    await client.connect()
    return new TestRedis(client)
  }

  async flush(): Promise<void> {
    await this.client.flushDb()
  }

  /** Raw access for suites that seed or inspect keys in the isolated Redis. */
  get connection(): RedisConnection {
    return this.client
  }

  async quit(): Promise<void> {
    if (this.client.isOpen) await this.client.quit()
  }
}

/**
 * Options of a test client that production code receives. They are the production options
 * (RESP 2, explicit queue timeout, keepalive) with only the socket fields a case needs replaced,
 * so a case never exercises a different protocol or timeout than the application does.
 */
export function appClientOptions(
  url: string,
  socket: Partial<AppRedisClientOptions['socket']> = {}
): AppRedisClientOptions {
  const base = redisClientOptions(url)
  return { ...base, socket: { ...base.socket, ...socket } }
}
