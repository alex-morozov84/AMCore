import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiClient, ApiNetworkError, ApiRequestError } from './http-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiClient', () => {
  it('GET requests a same-origin /api path and returns the parsed body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ user: { id: 'u1' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiClient.get<{ user: { id: string } }>('/auth/me')

    expect(result).toEqual({ user: { id: 'u1' } })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/me')
    expect(init.method).toBe('GET')
  })

  it('POST sends a JSON body with Content-Type', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ user: { id: 'u1' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.post('/auth/login', { email: 'a@b.com', password: 'x' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.com', password: 'x' })
  })

  it('POST with no body sends no body or Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await apiClient.post('/auth/logout')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBeUndefined()
    expect(init.headers).toBeUndefined()
  })

  it('returns undefined for a 204 No Content response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    expect(await apiClient.delete('/auth/sessions/1')).toBeUndefined()
  })

  it('throws ApiRequestError with the parsed body on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ statusCode: 401, message: 'nope', errorCode: 'INVALID_CREDENTIALS' }),
          {
            status: 401,
          }
        )
      )
    )

    await expect(apiClient.post('/auth/login', {})).rejects.toMatchObject({
      status: 401,
      body: { statusCode: 401, message: 'nope', errorCode: 'INVALID_CREDENTIALS' },
    })
  })

  it('ApiRequestError has an undefined body when the response has no parseable JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 500 })))

    const error = await apiClient.get('/auth/me').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiRequestError)
    expect((error as ApiRequestError).body).toBeUndefined()
  })

  it('throws ApiNetworkError when fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(apiClient.get('/auth/me')).rejects.toBeInstanceOf(ApiNetworkError)
  })
})
