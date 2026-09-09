// @vitest-environment node
import { headers } from 'next/headers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { resolveTrustedClientIp } from '../bff/trusted-client-ip'

import { getBackendAccessToken } from './access-token'
import { fetchBackend } from './backend-fetch'
import { generateCorrelationId } from './correlation-id'
import { BackendRequestError } from './errors'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('./access-token', () => ({ getBackendAccessToken: vi.fn() }))
vi.mock('./correlation-id', () => ({ generateCorrelationId: vi.fn() }))
vi.mock('../bff/trusted-client-ip', () => ({ resolveTrustedClientIp: vi.fn() }))

const schema = z.object({ id: z.string() })

function stubFetch(response: Response | (() => Response)) {
  const fetchMock = vi.fn().mockImplementation(async () => {
    if (typeof response === 'function') return response()
    return response
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
})

describe('fetchBackend', () => {
  it('returns success with the parsed body on a valid 2xx response', async () => {
    stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

    expect(await fetchBackend('/things/p1', schema)).toEqual({
      status: 'success',
      data: { id: 'p1' },
    })
  })

  it('throws BackendRequestError(invalid-payload) when a 2xx body fails the schema', async () => {
    stubFetch(new Response(JSON.stringify({ wrong: 'shape' }), { status: 200 }))

    const rejection = fetchBackend('/things/p1', schema)
    await expect(rejection).rejects.toBeInstanceOf(BackendRequestError)
    await expect(rejection).rejects.toMatchObject({ kind: 'invalid-payload' })
  })

  it('returns not-found on a real 404', async () => {
    stubFetch(new Response(null, { status: 404 }))

    expect(await fetchBackend('/things/missing', schema)).toEqual({ status: 'not-found' })
  })

  it('returns unavailable(rate-limited) with retryAfterMs on a 429', async () => {
    stubFetch(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))

    expect(await fetchBackend('/things', schema)).toEqual({
      status: 'unavailable',
      reason: 'rate-limited',
      retryAfterMs: 2000,
      correlationId: 'corr-1',
    })
  })

  it('returns unavailable(upstream) on a 5xx, without retryAfterMs when absent', async () => {
    stubFetch(new Response(null, { status: 503 }))

    expect(await fetchBackend('/things', schema)).toEqual({
      status: 'unavailable',
      reason: 'upstream',
      retryAfterMs: undefined,
      correlationId: 'corr-1',
    })
  })

  it('throws BackendRequestError(rejected) on a non-404 4xx', async () => {
    stubFetch(new Response(null, { status: 400 }))

    const rejection = fetchBackend('/things', schema)
    await expect(rejection).rejects.toBeInstanceOf(BackendRequestError)
    await expect(rejection).rejects.toMatchObject({ kind: 'rejected', status: 400 })
  })

  it('returns unavailable(network) when fetch itself throws a TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    expect(await fetchBackend('/things', schema)).toEqual({
      status: 'unavailable',
      reason: 'network',
      correlationId: 'corr-1',
    })
  })

  it('returns unavailable(timeout) when fetch aborts via AbortSignal.timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'TimeoutError'))
    )

    expect(await fetchBackend('/things', schema)).toEqual({
      status: 'unavailable',
      reason: 'timeout',
      correlationId: 'corr-1',
    })
  })

  it('rethrows an unrecognized thrown value instead of absorbing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('a genuine bug')))

    await expect(fetchBackend('/things', schema)).rejects.toThrow('a genuine bug')
  })

  it('attaches Authorization only when an access token is present', async () => {
    vi.mocked(getBackendAccessToken).mockResolvedValue('at-1')
    const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

    await fetchBackend('/things/p1', schema)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer at-1')
  })

  it('omits Authorization for an anonymous caller', async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

    await fetchBackend('/things/p1', schema)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Headers).has('Authorization')).toBe(false)
  })

  it('relays the trusted client IP header when resolved', async () => {
    vi.mocked(resolveTrustedClientIp).mockReturnValue('203.0.113.9')
    const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

    await fetchBackend('/things/p1', schema)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Headers).get('x-amcore-client-ip')).toBe('203.0.113.9')
  })

  it('requests the absolute API_URL, never a relative path', async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'p1' }), { status: 200 }))

    await fetchBackend('/things/p1', schema)

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/^https?:\/\/.+\/things\/p1$/)
  })
})
