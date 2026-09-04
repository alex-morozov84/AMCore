import { describe, expect, it } from 'vitest'

import { ApiNetworkError, ApiRequestError } from './http-client'
import { getQueryClient } from './query-client'

/**
 * Exercises the actual `retry`/`retryDelay` functions installed on the
 * client's `defaultOptions.queries` — not a reimplementation of the logic,
 * the real functions TanStack Query itself will call.
 */
function retryFns() {
  const options = getQueryClient().getDefaultOptions().queries!
  return {
    retry: options.retry as (failureCount: number, error: unknown) => boolean,
    retryDelay: options.retryDelay as (failureCount: number, error: unknown) => number,
  }
}

describe('query-client default retry policy (C1/C2, ADR-073)', () => {
  it('never retries a non-429 4xx', () => {
    const { retry } = retryFns()
    expect(retry(0, new ApiRequestError(400, undefined))).toBe(false)
    expect(retry(0, new ApiRequestError(401, undefined))).toBe(false)
    expect(retry(0, new ApiRequestError(404, undefined))).toBe(false)
    expect(retry(0, new ApiRequestError(422, undefined))).toBe(false)
  })

  it('retries a 429 up to the same bound as 5xx/network', () => {
    const { retry } = retryFns()
    expect(retry(0, new ApiRequestError(429, undefined))).toBe(true)
    expect(retry(1, new ApiRequestError(429, undefined))).toBe(true)
    expect(retry(2, new ApiRequestError(429, undefined))).toBe(true)
    expect(retry(3, new ApiRequestError(429, undefined))).toBe(false)
  })

  it('retries 5xx and network errors up to 3 times, as today', () => {
    const { retry } = retryFns()
    expect(retry(2, new ApiRequestError(503, undefined))).toBe(true)
    expect(retry(3, new ApiRequestError(503, undefined))).toBe(false)
    expect(retry(2, new ApiNetworkError(new Error('offline')))).toBe(true)
    expect(retry(3, new ApiNetworkError(new Error('offline')))).toBe(false)
  })

  it('honours a real Retry-After for retryDelay, in milliseconds', () => {
    const { retryDelay } = retryFns()
    const error = new ApiRequestError(429, undefined, 2)
    expect(retryDelay(0, error)).toBe(2000)
  })

  it('falls back to exponential backoff when there is no Retry-After', () => {
    const { retryDelay } = retryFns()
    const error = new ApiRequestError(503, undefined)
    expect(retryDelay(0, error)).toBe(1000)
    expect(retryDelay(1, error)).toBe(2000)
    expect(retryDelay(2, error)).toBe(4000)
  })
})
