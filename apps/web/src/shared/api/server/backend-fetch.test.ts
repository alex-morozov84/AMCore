// @vitest-environment node
import { headers } from 'next/headers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { SessionVaultUnavailableError } from '../bff/errors'
import { resolveTrustedClientIp } from '../bff/trusted-client-ip'

import { getBackendAccessToken } from './access-token'
import { fetchBackend } from './backend-fetch'
import { generateCorrelationId } from './correlation-id'
import { BackendAuthRequiredError, BackendRequestError } from './errors'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('./access-token', () => ({ getBackendAccessToken: vi.fn() }))
vi.mock('./correlation-id', () => ({ generateCorrelationId: vi.fn() }))
vi.mock('../bff/trusted-client-ip', () => ({ resolveTrustedClientIp: vi.fn() }))

const schema = z.object({ id: z.string() })

function stubFetch(response: Response | (() => Response)) {
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    if (init.signal?.aborted) throw init.signal.reason
    return typeof response === 'function' ? response() : response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(headers).mockResolvedValue(new Headers() as never)
  vi.mocked(generateCorrelationId).mockReturnValue('corr-1')
  vi.mocked(getBackendAccessToken).mockResolvedValue(null)
  vi.mocked(resolveTrustedClientIp).mockReturnValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchBackend - orchestration', () => {
  it('returns success with the parsed body on a valid 2xx response', async () => {
    stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

    expect(await fetchBackend('/things/p1', schema, { auth: 'none' })).toEqual({
      status: 'success',
      data: { id: 'p1' },
    })
  })

  it('throws BackendRequestError(invalid-payload) when a 2xx body fails the schema', async () => {
    stubFetch(new Response(JSON.stringify({ wrong: 'shape' }), { status: 200 }))

    const rejection = fetchBackend('/things/p1', schema, { auth: 'none' })
    await expect(rejection).rejects.toBeInstanceOf(BackendRequestError)
    await expect(rejection).rejects.toMatchObject({ kind: 'invalid-payload' })
  })

  it('returns not-found on a real 404', async () => {
    stubFetch(new Response(null, { status: 404 }))

    expect(await fetchBackend('/things/missing', schema, { auth: 'none' })).toEqual({
      status: 'not-found',
    })
  })

  it('returns unavailable(rate-limited) with retryAfterMs on a 429', async () => {
    stubFetch(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))

    expect(await fetchBackend('/things', schema, { auth: 'none' })).toEqual({
      status: 'unavailable',
      reason: 'rate-limited',
      retryAfterMs: 2000,
      correlationId: 'corr-1',
    })
  })

  it('returns unavailable(upstream) on a 5xx, without retryAfterMs when absent', async () => {
    stubFetch(new Response(null, { status: 503 }))

    expect(await fetchBackend('/things', schema, { auth: 'none' })).toEqual({
      status: 'unavailable',
      reason: 'upstream',
      retryAfterMs: undefined,
      correlationId: 'corr-1',
    })
  })

  it('throws BackendRequestError(rejected) on a non-404 4xx', async () => {
    stubFetch(new Response(null, { status: 400 }))

    const rejection = fetchBackend('/things', schema, { auth: 'none' })
    await expect(rejection).rejects.toBeInstanceOf(BackendRequestError)
    await expect(rejection).rejects.toMatchObject({ kind: 'rejected', status: 400 })
  })

  it('returns unavailable(network) when fetch itself throws a TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    expect(await fetchBackend('/things', schema, { auth: 'none' })).toEqual({
      status: 'unavailable',
      reason: 'network',
      correlationId: 'corr-1',
    })
  })

  it('rethrows an unrecognized thrown value instead of absorbing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('a genuine bug')))

    await expect(fetchBackend('/things', schema, { auth: 'none' })).rejects.toThrow('a genuine bug')
  })

  it('requests the absolute API_URL, never a relative path', async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

    await fetchBackend('/things/p1', schema, { auth: 'none' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/^https?:\/\/.+\/things\/p1$/)
  })

  describe('auth modes', () => {
    it("'none' never resolves a token even if one is available", async () => {
      vi.mocked(getBackendAccessToken).mockResolvedValue('at-1')
      const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

      await fetchBackend('/things/p1', schema, { auth: 'none' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Headers).has('Authorization')).toBe(false)
    })

    it("'optional' attaches Authorization when a session exists", async () => {
      vi.mocked(getBackendAccessToken).mockResolvedValue('at-1')
      const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

      await fetchBackend('/things/p1', schema, { auth: 'optional' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Headers).get('Authorization')).toBe('Bearer at-1')
    })

    it("'optional' proceeds anonymously when logged out, never throws", async () => {
      const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

      await fetchBackend('/things/p1', schema, { auth: 'optional' })

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Headers).has('Authorization')).toBe(false)
    })

    it("'optional' returns unavailable (never anonymous) when the vault is down, and never calls fetch", async () => {
      vi.mocked(getBackendAccessToken).mockRejectedValue(
        new SessionVaultUnavailableError(new Error('Redis unreachable'))
      )
      const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

      expect(await fetchBackend('/things/p1', schema, { auth: 'optional' })).toMatchObject({
        status: 'unavailable',
        reason: 'upstream',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("'optional' rethrows an unknown auth-resolution error and never calls fetch", async () => {
      vi.mocked(getBackendAccessToken).mockRejectedValue(new Error('programming defect'))
      const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

      await expect(fetchBackend('/things/p1', schema, { auth: 'optional' })).rejects.toThrow(
        'programming defect'
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("'required' throws BackendAuthRequiredError when logged out, and never calls fetch", async () => {
      const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

      await expect(fetchBackend('/things/p1', schema, { auth: 'required' })).rejects.toBeInstanceOf(
        BackendAuthRequiredError
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('deadline and cancellation', () => {
    it('classifies a deadline expiry as unavailable(timeout), not caller cancellation', async () => {
      vi.useFakeTimers()
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
            })
        )
      )

      const resultPromise = fetchBackend('/things', schema, { auth: 'none', timeoutMs: 1_000 })
      await vi.advanceTimersByTimeAsync(1_000)

      expect(await resultPromise).toEqual({
        status: 'unavailable',
        reason: 'timeout',
        correlationId: 'corr-1',
      })
    })

    it('rethrows the caller signal reason instead of classifying it as unavailable', async () => {
      const callerController = new AbortController()
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(
          (_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
            })
        )
      )

      const resultPromise = fetchBackend('/things', schema, {
        auth: 'none',
        signal: callerController.signal,
      })
      callerController.abort('user navigated away')

      await expect(resultPromise).rejects.toBe('user navigated away')
    })

    it('rethrows a caller signal that was already aborted before the call', async () => {
      const callerController = new AbortController()
      callerController.abort('navigation already cancelled')
      const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

      await expect(
        fetchBackend('/things', schema, { auth: 'none', signal: callerController.signal })
      ).rejects.toBe('navigation already cancelled')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
