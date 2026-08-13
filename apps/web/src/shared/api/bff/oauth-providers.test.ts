// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getOAuthProviders } from './oauth-providers'

vi.mock('server-only', () => ({}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getOAuthProviders', () => {
  it('returns the configured providers on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ providers: ['google'] }), { status: 200 }))
    )

    expect(await getOAuthProviders()).toEqual(['google'])
  })

  it('requests the unauthenticated backend endpoint directly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ providers: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await getOAuthProviders()

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5002/api/v1/auth/oauth/providers')
  })

  it('degrades to an empty list on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })))

    expect(await getOAuthProviders()).toEqual([])
  })

  it('degrades to an empty list when fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))

    expect(await getOAuthProviders()).toEqual([])
  })

  it('degrades to an empty list on a malformed body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 }))
    )

    expect(await getOAuthProviders()).toEqual([])
  })
})
