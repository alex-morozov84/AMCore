import type { Pool, PoolClient } from 'pg'

import type { PhysicalTransaction } from './observed-pg-adapter'

/** Shared pool capability, no second pool: uncertain cleanup must not return a healthy-looking socket. */
export function observedPgPool(
  pool: Pool,
  currentToken: () => PhysicalTransaction | undefined
): Pool {
  return new Proxy(pool, {
    get(target, key) {
      if (key === 'connect')
        return async () => {
          const token = currentToken()
          const client = await target.connect()
          return observeClient(client, token)
        }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function observeClient(client: PoolClient, token: PhysicalTransaction | undefined): PoolClient {
  return new Proxy(client, {
    get(target, key) {
      if (key === 'release')
        return (error?: Error | boolean) => {
          // Prisma may call release after a failed COMMIT/ROLLBACK. Destroy that socket via pg's
          // supported release(error), but keep the permit quarantined: destruction is not SQL ack.
          target.release(error || (token?.quarantined ? true : undefined))
        }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
