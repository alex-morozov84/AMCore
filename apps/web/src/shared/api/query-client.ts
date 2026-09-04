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

const MAX_RETRY_DELAY_MS = 30_000

/**
 * Honour a real `Retry-After` (ADR-073) when the error carried one — set
 * only on the global rate-limit 429 today, transparently applies to any
 * future `Retry-After`-bearing response. Capped at `MAX_RETRY_DELAY_MS`,
 * same as the fallback below: a `Retry-After` is server-supplied and this
 * client has no control over its value — a proxy/CDN in front of `apps/api`
 * emitting a 503 + a minutes/hours-long `Retry-After` (standard practice
 * for nginx/ALB/Cloudflare maintenance windows) must not turn into a
 * multi-hour hung retry with no error shown. Otherwise TanStack Query's own
 * default exponential backoff.
 */
function retryDelay(failureCount: number, error: unknown): number {
  const retryAfterMs = getRetryAfterMs(error)
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS)
  return Math.min(1000 * 2 ** failureCount, MAX_RETRY_DELAY_MS)
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
