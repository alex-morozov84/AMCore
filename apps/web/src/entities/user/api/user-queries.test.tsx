import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { authApi } from '@/shared/api'

import { useDeleteAvatar, userKeys, useSessions, useUploadAvatar } from './user-queries'

vi.mock('@/shared/api', () => ({
  authApi: { getSessions: vi.fn(), uploadAvatar: vi.fn(), deleteAvatar: vi.fn() },
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(userKeys.me(), { user: { id: 'u1' }, contextSession: 'session-u1' })
  return (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{}}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
}

function wrapperWithCachedUser(avatarUrl: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(userKeys.me(), { user: { id: 'u1' }, contextSession: 'session-u1' })
  queryClient.setQueryData(userKeys.me(), {
    user: { id: 'u1', avatarUrl },
    contextSession: 'session-u1',
  })
  return {
    queryClient,
    Wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  }
}

describe('userKeys.sessions', () => {
  it('includes page and limit, so different pages get different cache entries', () => {
    expect(
      userKeys.sessions({ userId: 'u1', contextSession: 'session-u1' }, DEFAULT_LOCALE, 1, 20)
    ).not.toEqual(
      userKeys.sessions({ userId: 'u1', contextSession: 'session-u1' }, DEFAULT_LOCALE, 2, 20)
    )
  })
})

describe('useSessions', () => {
  it('fetches the requested page/limit through authApi.getSessions with the active locale', async () => {
    vi.mocked(authApi.getSessions).mockResolvedValue({ data: [], total: 0, page: 2, limit: 10 })

    const { result } = renderHook(() => useSessions(2, 10), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(authApi.getSessions).toHaveBeenCalledWith(2, 10, DEFAULT_LOCALE)
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
      contextSession: 'session-u1',
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

    expect(queryClient.getQueryData(userKeys.me())).toEqual({
      user: { id: 'u1', avatarUrl: null },
      contextSession: 'session-u1',
    })
  })
})

it.each(['upload', 'delete'] as const)(
  'late avatar %s cannot update replacement user B',
  async (action) => {
    const held = Promise.withResolvers<{ avatarUrl: string }>()
    if (action === 'upload') vi.mocked(authApi.uploadAvatar).mockReturnValueOnce(held.promise)
    else
      vi.mocked(authApi.deleteAvatar).mockImplementationOnce(async () => {
        await held.promise
      })
    const { queryClient, Wrapper } = wrapperWithCachedUser('A-avatar')
    const hook = renderHook(() => ({ upload: useUploadAvatar(), remove: useDeleteAvatar() }), {
      wrapper: Wrapper,
    })
    let pending!: Promise<unknown>
    act(() => {
      pending =
        action === 'upload'
          ? hook.result.current.upload.mutateAsync(new File(['x'], 'avatar.png'))
          : hook.result.current.remove.mutateAsync()
    })
    await waitFor(() =>
      expect(
        action === 'upload' ? authApi.uploadAvatar : authApi.deleteAvatar
      ).toHaveBeenCalledOnce()
    )
    const replacement = { user: { id: 'B', avatarUrl: 'B-avatar' } }
    act(() => {
      queryClient.clear()
      queryClient.setQueryData(userKeys.me(), replacement)
    })
    await act(async () => {
      held.resolve({ avatarUrl: 'A-late-avatar' })
      await pending
    })
    expect(queryClient.getQueryData(userKeys.me())).toEqual(replacement)
  }
)

it.each(['tokenless', 'missing', 'removed', 'changed-token'] as const)(
  'does not publish an avatar through an unusable %s capture',
  async (boundary) => {
    const { queryClient, Wrapper } = wrapperWithCachedUser(null)
    if (boundary === 'tokenless')
      queryClient.setQueryData(userKeys.me(), { user: { id: 'u1', avatarUrl: null } })
    if (boundary === 'missing') queryClient.clear()
    const held = Promise.withResolvers<{ avatarUrl: string }>()
    vi.mocked(authApi.uploadAvatar).mockReturnValueOnce(held.promise)
    const hook = renderHook(() => useUploadAvatar(), { wrapper: Wrapper })
    let pending!: Promise<unknown>
    act(() => {
      pending = hook.result.current.mutateAsync(new File(['x'], 'avatar.png'))
    })
    await waitFor(() => expect(authApi.uploadAvatar).toHaveBeenCalledOnce())
    if (boundary === 'removed') queryClient.removeQueries({ queryKey: userKeys.me(), exact: true })
    if (boundary === 'changed-token')
      queryClient.setQueryData(userKeys.me(), {
        user: { id: 'u1', avatarUrl: null },
        contextSession: 'next-session',
      })
    const before = queryClient.getQueryData(userKeys.me())
    await act(async () => {
      held.resolve({ avatarUrl: 'late' })
      await pending
    })
    expect(queryClient.getQueryData(userKeys.me())).toEqual(before)
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))
  }
)
