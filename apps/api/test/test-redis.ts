import { createClient, type RedisClientType } from '@redis/client'
import type { StartedRedisContainer } from '@testcontainers/redis'

/** The client type `createClient` infers when no modules or RESP version are configured. */
export type RedisConnection = RedisClientType<
  Record<never, never>,
  Record<never, never>,
  Record<never, never>,
  2
>
const open = (url: string): RedisConnection => createClient({ url })

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
