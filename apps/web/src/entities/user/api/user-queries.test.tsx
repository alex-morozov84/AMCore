import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { authApi } from '@/shared/api'

import { useDeleteAvatar, userKeys, useSessions, useUploadAvatar } from './user-queries'

vi.mock('@/shared/api', () => ({
  authApi: { getSessions: vi.fn(), uploadAvatar: vi.fn(), deleteAvatar: vi.fn() },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function wrapperWithCachedUser(avatarUrl: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(userKeys.me(), { user: { id: 'u1', avatarUrl } })
  return {
    queryClient,
    Wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  }
}

describe('userKeys.sessions', () => {
  it('includes page and limit, so different pages get different cache entries', () => {
    expect(userKeys.sessions(1, 20)).not.toEqual(userKeys.sessions(2, 20))
  })
})

describe('useSessions', () => {
  it('fetches the requested page/limit through authApi.getSessions', async () => {
    vi.mocked(authApi.getSessions).mockResolvedValue({ data: [], total: 0, page: 2, limit: 10 })

    const { result } = renderHook(() => useSessions(2, 10), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(authApi.getSessions).toHaveBeenCalledWith(2, 10)
    expect(result.current.data).toEqual({ data: [], total: 0, page: 2, limit: 10 })
  })
})

describe('useUploadAvatar', () => {
  it('merges the returned avatarUrl into the cached current user', async () => {
    vi.mocked(authApi.uploadAvatar).mockResolvedValue({ avatarUrl: 'https://x/new.png' })
    const { queryClient, Wrapper } = wrapperWithCachedUser(null)

    const { result } = renderHook(() => useUploadAvatar(), { wrapper: Wrapper })
    result.current.mutate(new File(['x'], 'new.png'))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(queryClient.getQueryData(userKeys.me())).toEqual({
      user: { id: 'u1', avatarUrl: 'https://x/new.png' },
    })
  })
})

describe('useDeleteAvatar', () => {
  it('clears the cached avatarUrl to null', async () => {
    vi.mocked(authApi.deleteAvatar).mockResolvedValue(undefined)
    const { queryClient, Wrapper } = wrapperWithCachedUser('https://x/old.png')

    const { result } = renderHook(() => useDeleteAvatar(), { wrapper: Wrapper })
    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(queryClient.getQueryData(userKeys.me())).toEqual({ user: { id: 'u1', avatarUrl: null } })
  })
})
