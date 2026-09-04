import { isServer, QueryClient } from '@tanstack/react-query'

import { getErrorStatus, getRetryAfterMs } from './errors'

const MAX_RETRIES = 3

/**
 * TanStack Query's own default retry function retries any error, including
 * a genuine client-input error (400/404/422/...), up to 3 times — pointless
 * for a request that will never succeed unchanged. Never retry a 4xx
 * **except** 429: a rate-limit refusal is retryable by definition ("try
 * again later"), unlike every other 4xx. 5xx/network errors keep today's
 * behavior, up to `MAX_RETRIES`.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false
  const status = getErrorStatus(error)
  if (status !== undefined && status >= 400 && status < 500) {
    return status === 429
  }
  return true
}

/**
 * Honour a real `Retry-After` (ADR-073) when the error carried one — set
 * only on the global rate-limit 429 today, transparently applies to any
 * future `Retry-After`-bearing response. Otherwise TanStack Query's own
 * default exponential backoff.
 */
function retryDelay(failureCount: number, error: unknown): number {
  const retryAfterMs = getRetryAfterMs(error)
  if (retryAfterMs !== undefined) return retryAfterMs
  return Math.min(1000 * 2 ** failureCount, 30_000)
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, set staleTime above 0 to avoid refetching on client
        staleTime: 60 * 1000, // 1 minute
        // Disable automatic refetch on window focus in development
        refetchOnWindowFocus: process.env.NODE_ENV === 'production',
        retry: shouldRetry,
        retryDelay,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined = undefined

export function getQueryClient() {
  if (isServer) {
    // Server: always create a new query client
    return makeQueryClient()
  }

  // Browser: reuse existing client or create new one
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient()
  }

  return browserQueryClient
}
