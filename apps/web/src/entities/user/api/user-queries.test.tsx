import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { authApi } from '@/shared/api'

import { userKeys, useSessions } from './user-queries'

vi.mock('@/shared/api', () => ({ authApi: { getSessions: vi.fn() } }))

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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
