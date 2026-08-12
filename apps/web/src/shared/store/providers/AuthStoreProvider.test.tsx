import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthStoreProvider, useAuthStore } from './AuthStoreProvider'

function StatusProbe() {
  const status = useAuthStore((state) => state.status)
  const user = useAuthStore((state) => state.user)
  return <div data-testid="status">{`${status}:${user?.id ?? 'none'}`}</div>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthStoreProvider — mount-time auth check via the BFF', () => {
  it('authenticates when GET /api/auth/me returns a user', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ user: { id: 'u1' } }), { status: 200 }))
    )

    render(
      <AuthStoreProvider>
        <StatusProbe />
      </AuthStoreProvider>
    )

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated:u1'))
    expect(fetch).toHaveBeenCalledWith('/api/auth/me')
  })

  it('treats a { user: null } response as unauthenticated rather than logging in with no user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: null }), { status: 200 }))
    )

    render(
      <AuthStoreProvider>
        <StatusProbe />
      </AuthStoreProvider>
    )

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated:none')
    )
  })

  it('treats a non-ok response as unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))

    render(
      <AuthStoreProvider>
        <StatusProbe />
      </AuthStoreProvider>
    )

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated:none')
    )
  })
})
