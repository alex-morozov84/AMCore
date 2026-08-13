import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  notificationKeys,
  useMarkNotificationRead,
  useNotificationCapabilities,
  useNotificationsFeed,
  useUnreadCount,
} from './notification-queries'
import { notificationsApi } from './notifications-api'

vi.mock('./notifications-api', () => ({
  notificationsApi: {
    getFeed: vi.fn(),
    getUnreadCount: vi.fn(),
    markRead: vi.fn(),
    getCapabilities: vi.fn(),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, Wrapper }
}

describe('notificationKeys.feed', () => {
  it('scopes different limits to different cache entries under a shared feedAll prefix', () => {
    expect(notificationKeys.feed(10)).not.toEqual(notificationKeys.feed(20))
    expect(notificationKeys.feed(10).slice(0, notificationKeys.feedAll().length)).toEqual(
      notificationKeys.feedAll()
    )
  })
})

describe('useNotificationsFeed', () => {
  it('requests the next page using the previous page nextCursor', async () => {
    vi.mocked(notificationsApi.getFeed).mockResolvedValue({
      data: [],
      nextCursor: 'c1',
      hasMore: true,
    })

    const { result } = renderHook(() => useNotificationsFeed(10), {
      wrapper: createWrapper().Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    await result.current.fetchNextPage()

    expect(notificationsApi.getFeed).toHaveBeenLastCalledWith('c1', 10)
  })

  it('stops paginating once hasMore is false', async () => {
    vi.mocked(notificationsApi.getFeed).mockResolvedValue({
      data: [],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(() => useNotificationsFeed(10), {
      wrapper: createWrapper().Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.hasNextPage).toBe(false)
  })
})

describe('useUnreadCount', () => {
  it('fetches the unread count', async () => {
    vi.mocked(notificationsApi.getUnreadCount).mockResolvedValue({ unread: 3 })

    const { result } = renderHook(() => useUnreadCount(), { wrapper: createWrapper().Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({ unread: 3 })
  })
})

describe('useNotificationCapabilities', () => {
  it('fetches the active channel/category registry', async () => {
    const capabilities = {
      channels: ['in_app', 'email'],
      categories: [
        { category: 'security', channels: ['in_app', 'email'], overridableChannels: [] },
      ],
    }
    vi.mocked(notificationsApi.getCapabilities).mockResolvedValue(capabilities)

    const { result } = renderHook(() => useNotificationCapabilities(), {
      wrapper: createWrapper().Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(capabilities)
  })
})

describe('useMarkNotificationRead', () => {
  it('invalidates the feed and unread count on success', async () => {
    vi.mocked(notificationsApi.markRead).mockResolvedValue(undefined)
    const { queryClient, Wrapper } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper: Wrapper })
    result.current.mutate('notif-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: notificationKeys.feedAll() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: notificationKeys.unreadCount() })
  })
})
