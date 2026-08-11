import { createClient } from '@redis/client'

import 'server-only'

function createWebRedisClient() {
  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error(
      'REDIS_URL is not set. The web runtime requires Redis for authenticated BFF flows - see ADR-068.'
    )
  }

  const client = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
    },
  })

  client.on('error', (error) => {
    console.error('[bff] Redis client error', error)
  })

  return client
}

// No explicit return-type annotation on the factory above: `createClient`'s
// generic defaults don't structurally match a separately-computed
// `ReturnType<typeof createClient>` alias (a `@redis/client` inference
// quirk), so `WebRedisClient` is derived from the factory itself instead.
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
