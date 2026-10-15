import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authApi } from '@/shared/api'
import { ApiNetworkError, ApiRequestError } from '@/shared/api/http-client'

import { userKeys } from '../api/user-queries'

import { AVATAR_LIMITS, useAvatarEditor } from './use-avatar-editor'

vi.mock('@/shared/api', () => ({
  authApi: { getMe: vi.fn(), uploadAvatar: vi.fn(), deleteAvatar: vi.fn() },
}))

const png = (size = 10, type = 'image/png') => new File([new Uint8Array(size)], 'a.png', { type })

function setup(userId = 'u1', avatarUrl: string | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(userKeys.me(), { user: { id: userId, avatarUrl } })
  // A re-read (after an unknown outcome) returns the same signed-in user.
  vi.mocked(authApi.getMe).mockResolvedValue({ user: { id: userId, avatarUrl } } as never)
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, ...renderHook(() => useAvatarEditor(), { wrapper }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authApi.getMe).mockResolvedValue({ user: null } as never)
})

describe('useAvatarEditor', () => {
  it('commits an upload: returns the new URL and merges it into the cached user', async () => {
    vi.mocked(authApi.uploadAvatar).mockResolvedValue({ avatarUrl: 'https://f/new.webp' })
    const { result, queryClient } = setup()
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.upload(png())
    })
    expect(outcome).toEqual({ kind: 'committed', avatarUrl: 'https://f/new.webp' })
    expect(queryClient.getQueryData(userKeys.me())).toEqual({
      user: { id: 'u1', avatarUrl: 'https://f/new.webp' },
    })
    expect(result.current.status).toBe('idle')
    expect(result.current.avatarUrl).toBe('https://f/new.webp')
  })

  it('commits a removal and clears the cached URL', async () => {
    vi.mocked(authApi.deleteAvatar).mockResolvedValue(undefined)
    const { result } = setup('u1', 'https://f/old.webp')
    await act(async () => {
      await result.current.remove()
    })
    expect(result.current.avatarUrl).toBeNull()
    expect(result.current.outcome).toEqual({ kind: 'committed', avatarUrl: null })
  })

  it('refuses a too-large or wrong-type file before any request', async () => {
    const { result } = setup()
    let big: unknown
    let bad: unknown
    await act(async () => {
      big = await result.current.upload(png(AVATAR_LIMITS.maxBytes + 1))
      bad = await result.current.upload(png(10, 'image/gif'))
    })
    expect(big).toMatchObject({ kind: 'rejected', reason: 'too_large' })
    expect(bad).toMatchObject({ kind: 'rejected', reason: 'invalid_type' })
    expect(authApi.uploadAvatar).not.toHaveBeenCalled()
    expect(result.current.status).toBe('error')
  })

  it.each([
    [413, 'rejected', 'too_large'],
    [400, 'rejected', 'invalid_type'],
    [403, 'rejected', 'other'],
  ])('maps HTTP %i to %s/%s and leaves the avatar unchanged', async (status, kind, reason) => {
    vi.mocked(authApi.uploadAvatar).mockRejectedValue(new ApiRequestError(status, undefined))
    const { result } = setup('u1', 'https://f/old.webp')
    await act(async () => {
      await result.current.upload(png())
    })
    expect(result.current.outcome).toMatchObject({ kind, reason })
    expect(result.current.status).toBe('error')
    expect(result.current.avatarUrl).toBe('https://f/old.webp')
  })

  it('reports a locked avatar (503) as busy', async () => {
    vi.mocked(authApi.uploadAvatar).mockRejectedValue(new ApiRequestError(503, undefined))
    const { result } = setup()
    await act(async () => {
      await result.current.upload(png())
    })
    expect(result.current.outcome).toMatchObject({ kind: 'busy' })
  })

  it('reports network loss and server failure as unknown, never as rejected', async () => {
    vi.mocked(authApi.uploadAvatar).mockRejectedValueOnce(new ApiNetworkError(new Error('x')))
    vi.mocked(authApi.uploadAvatar).mockRejectedValueOnce(new ApiRequestError(500, undefined))
    const { result } = setup()
    await act(async () => {
      await result.current.upload(png())
    })
    expect(result.current.outcome).toMatchObject({ kind: 'unknown' })
    await act(async () => {
      await result.current.upload(png())
    })
    expect(result.current.outcome).toMatchObject({ kind: 'unknown' })
  })

  it('rereads the current user once after an unknown outcome', async () => {
    vi.mocked(authApi.uploadAvatar).mockRejectedValue(new ApiNetworkError(new Error('x')))
    const { result } = setup('u1', 'https://f/old.webp')
    await act(async () => {
      await result.current.upload(png())
    })
    await waitFor(() => expect(authApi.getMe).toHaveBeenCalledTimes(1))
    expect(result.current.outcome).toMatchObject({ kind: 'unknown' })

    // The reread brings the server's real avatar, and the hook shows it.
    vi.mocked(authApi.getMe).mockResolvedValue({
      user: { id: 'u1', avatarUrl: 'https://f/real.webp' },
    } as never)
    await act(async () => {
      await result.current.upload(png())
    })
    await waitFor(() => expect(result.current.avatarUrl).toBe('https://f/real.webp'))
  })

  it.each([
    ['rejected', new ApiRequestError(413, undefined)],
    ['busy', new ApiRequestError(503, undefined)],
  ])('does not reread the user after a %s outcome', async (_name, error) => {
    vi.mocked(authApi.uploadAvatar).mockRejectedValue(error)
    const { result } = setup()
    await act(async () => {
      await result.current.upload(png())
    })
    expect(authApi.getMe).not.toHaveBeenCalled()
  })

  it('does not reread the user after a retired outcome', async () => {
    let fail: (reason: unknown) => void = () => undefined
    vi.mocked(authApi.uploadAvatar).mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject
      })
    )
    const { result, queryClient } = setup('u1')
    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pending = result.current.upload(png())
    })
    act(() => {
      queryClient.setQueryData(userKeys.me(), { user: { id: 'u2', avatarUrl: null } })
    })
    await waitFor(() => expect(result.current.user?.id).toBe('u2'))
    await act(async () => {
      fail(new ApiNetworkError(new Error('x')))
      await pending
    })
    expect(authApi.getMe).not.toHaveBeenCalled()
  })

  it('answers busy to a second action while one is pending', async () => {
    let finish: (value: { avatarUrl: string }) => void = () => undefined
    vi.mocked(authApi.uploadAvatar).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const { result } = setup()
    let first: Promise<unknown> = Promise.resolve()
    let second: unknown
    await act(async () => {
      first = result.current.upload(png())
      second = await result.current.remove()
    })
    expect(second).toEqual({ kind: 'busy' })
    expect(authApi.deleteAvatar).not.toHaveBeenCalled()
    await act(async () => {
      finish({ avatarUrl: 'https://f/a.webp' })
      await first
    })
  })

  it('drops a late success after the signed-in user changed (retired)', async () => {
    let finish: (value: { avatarUrl: string }) => void = () => undefined
    vi.mocked(authApi.uploadAvatar).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const { result, queryClient } = setup('u1')
    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pending = result.current.upload(png())
    })
    act(() => {
      queryClient.setQueryData(userKeys.me(), { user: { id: 'u2', avatarUrl: null } })
    })
    await waitFor(() => expect(result.current.user?.id).toBe('u2'))
    let outcome: unknown
    await act(async () => {
      finish({ avatarUrl: 'https://f/late.webp' })
      outcome = await pending
    })
    expect(outcome).toEqual({ kind: 'retired' })
    expect(queryClient.getQueryData(userKeys.me())).toEqual({
      user: { id: 'u2', avatarUrl: null },
    })
    expect(result.current.outcome).toBeNull()
  })

  it('drops a late failure after the signed-in user changed', async () => {
    let fail: (reason: unknown) => void = () => undefined
    vi.mocked(authApi.uploadAvatar).mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject
      })
    )
    const { result, queryClient } = setup('u1')
    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pending = result.current.upload(png())
    })
    act(() => {
      queryClient.setQueryData(userKeys.me(), { user: { id: 'u2', avatarUrl: null } })
    })
    await waitFor(() => expect(result.current.user?.id).toBe('u2'))
    await act(async () => {
      fail(new ApiRequestError(413, undefined))
      await pending
    })
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBeNull()
  })
})
