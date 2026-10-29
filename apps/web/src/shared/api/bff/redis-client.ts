import { createBffRedisClient } from './redis-client-options'

import 'server-only'

function createWebRedisClient() {
  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error(
      'REDIS_URL is not set. The web runtime requires Redis for authenticated BFF flows - see ADR-068.'
    )
  }

  const client = createBffRedisClient(url)

  client.on('error', (error) => {
    console.error('[bff] Redis client error', error)
  })

  return client
}

// Derived from the factory, not from a separate `ReturnType<typeof createClient>`: the factory
// pins RESP 2, and the library's generic default (RESP 3) would not match it.
export type WebRedisClient = ReturnType<typeof createWebRedisClient>

// Standalone Next.js server (ADR-038-style packaging) is a long-lived
// process, so one connection shared across requests is correct — unlike
// per-request access-token state, a connection pool has no per-user data.
// Cached as a Promise so concurrent early callers await the same connect()
// instead of racing to open multiple sockets.
let clientPromise: Promise<WebRedisClient> | undefined

/** Lazily connects a shared Redis client for the BFF session vault. */
export async function getWebRedisClient(): Promise<WebRedisClient> {
  if (!clientPromise) {
    const client = createWebRedisClient()
    clientPromise = client.connect().then(() => client)
    clientPromise.catch(() => {
      // Allow a later call to retry instead of permanently caching a failed connect.
      clientPromise = undefined
    })
  }

  return clientPromise
}
