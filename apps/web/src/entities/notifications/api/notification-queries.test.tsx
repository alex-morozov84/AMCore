import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// eslint-disable-next-line boundaries/dependencies -- Integration fixture verifies the actual bootstrap consumer with notification hooks.
import { useCurrentUser } from '@/entities/user'
import {
  currentUserKey,
  publishCurrentUser,
  type QueryOwner,
  queryOwner,
  type UserEnvelope,
} from '@/shared/api/query-session'

import {
  notificationKeys,
  useArchiveNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationCapabilities,
  useNotificationsFeed,
  useUnreadCount,
} from './notification-queries'
import { notificationsApi } from './notifications-api'

const owner = { userId: 'a', contextSession: 's1' }
const envelope = (value: QueryOwner | null) =>
  ({
    user: value ? { id: value.userId } : null,
    contextSession: value?.contextSession,
  }) as UserEnvelope
afterEach(() => {
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(currentUserKey, envelope(owner))
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, Wrapper }
}

describe('notificationKeys.feed', () => {
  it('scopes different limits to different cache entries under a shared feedAll prefix', () => {
    expect(notificationKeys.feed(owner, 10)).not.toEqual(notificationKeys.feed(owner, 20))
    expect(
      notificationKeys.feed(owner, 10).slice(0, notificationKeys.feedAll(owner).length)
    ).toEqual(notificationKeys.feedAll(owner))
  })
})

describe('useNotificationsFeed', () => {
  it('requests the next page using the previous page nextCursor', async () => {
    vi.spyOn(notificationsApi, 'getFeed').mockResolvedValue({
      data: [],
      nextCursor: 'c1',
      hasMore: true,
    })

    const { result } = renderHook(() => useNotificationsFeed(owner, 10), {
      wrapper: createWrapper().Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    await result.current.fetchNextPage()

    expect(notificationsApi.getFeed).toHaveBeenLastCalledWith('c1', 10, expect.any(AbortSignal))
  })

  it('stops paginating once hasMore is false', async () => {
    vi.spyOn(notificationsApi, 'getFeed').mockResolvedValue({
      data: [],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(() => useNotificationsFeed(owner, 10), {
      wrapper: createWrapper().Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.hasNextPage).toBe(false)
  })
})

describe('useUnreadCount', () => {
  it('fetches the unread count', async () => {
    vi.spyOn(notificationsApi, 'getUnreadCount').mockResolvedValue({ unread: 3 })

    const { result } = renderHook(() => useUnreadCount(owner), { wrapper: createWrapper().Wrapper })
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
    vi.spyOn(notificationsApi, 'getCapabilities').mockResolvedValue(capabilities)

    const { result } = renderHook(() => useNotificationCapabilities(), {
      wrapper: createWrapper().Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(capabilities)
  })
})

describe('useMarkNotificationRead', () => {
  it('invalidates the feed and unread count on success', async () => {
    vi.spyOn(notificationsApi, 'markRead').mockResolvedValue(undefined)
    const { queryClient, Wrapper } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useMarkNotificationRead(owner), { wrapper: Wrapper })
    result.current.mutate('notif-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: notificationKeys.owned(owner) })
  })
})

function transportQueue() {
  const requests: {
    url: string
    signal?: AbortSignal | null
    method: string
    done: ReturnType<typeof Promise.withResolvers<Response>>
  }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const done = Promise.withResolvers<Response>()
      requests.push({ url, signal: init.signal, method: init.method!, done })
      return done.promise
    })
  )
  return requests
}

it.each(['other-user', 'same-user'] as const)(
  'retires pending pages and mounted data on %s replacement',
  async (kind) => {
    const { queryClient: client, Wrapper } = createWrapper()
    const requests = transportQueue()
    const next = { userId: kind === 'other-user' ? 'b' : 'a', contextSession: 's2' }
    const { result, unmount } = renderHook(
      () => {
        const active = queryOwner(useCurrentUser().data)
        return { feed: useNotificationsFeed(active), count: useUnreadCount(active) }
      },
      { wrapper: Wrapper }
    )
    await waitFor(() => expect(requests).toHaveLength(2))
    await act(async () => {
      requests[0]!.done.resolve(
        Response.json({ data: [{ id: 'old' }], nextCursor: 'c1', hasMore: true })
      )
      requests[1]!.done.resolve(Response.json({ unread: 1 }))
    })
    await waitFor(() => expect(result.current.count.data?.unread).toBe(1))
    act(() => {
      void result.current.feed.fetchNextPage()
    })
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(requests[2]!.url).toContain('cursor=c1')
    await act(async () => {
      await publishCurrentUser(client, envelope(next))
    })
    await waitFor(() => expect(requests).toHaveLength(5))
    expect(result.current.feed.data).toBeUndefined()
    expect(result.current.count.data).toBeUndefined()
    expect(requests[2]!.signal?.aborted).toBe(true)
    await act(async () => {
      requests[3]!.done.resolve(Response.json({ data: [], nextCursor: null, hasMore: false }))
      requests[4]!.done.resolve(Response.json({ unread: 2 }))
      requests[2]!.done.resolve(
        Response.json({ data: [{ id: 'late' }], nextCursor: null, hasMore: false })
      )
    })
    await waitFor(() => expect(result.current.count.data?.unread).toBe(2))
    expect(client.getQueriesData({ queryKey: notificationKeys.owned(owner) })).toEqual([])
    expect(result.current.feed.data?.pages.flatMap((p) => p.data)).toEqual([])
    await act(async () => {
      await publishCurrentUser(client, envelope(null))
    })
    await waitFor(() => expect(result.current.count.data).toBeUndefined())
    const size = requests.length
    await act(async () => {
      await result.current.count.refetch()
      await result.current.feed.fetchNextPage()
    })
    expect(requests).toHaveLength(size)
    await act(async () => {
      await publishCurrentUser(client, envelope(owner))
    })
    await waitFor(() => expect(requests).toHaveLength(size + 2))
    expect(result.current.feed.data).toBeUndefined()
    unmount()
  }
)

const actions = [
  useMarkNotificationRead,
  useArchiveNotification,
  useMarkAllNotificationsRead,
] as const
it.each(
  actions.flatMap((action) => ['other-user', 'same-user'].map((kind) => [action, kind] as const))
)('%s keeps original admission and completion across %s replacement', async (useAction, kind) => {
  const { queryClient: client, Wrapper } = createWrapper()
  const requests = transportQueue()
  const { result, unmount } = renderHook(() => useAction(queryOwner(useCurrentUser().data)), {
    wrapper: Wrapper,
  })
  const next = { userId: kind === 'other-user' ? 'b' : 'a', contextSession: 's2' }
  onlineManager.setOnline(false)
  act(() => result.current.mutate('n1' as never))
  await waitFor(() => expect(result.current.isPaused).toBe(true))
  const pending = client.getMutationCache().getAll()[0]!
  await act(async () => {
    await publishCurrentUser(client, envelope(next))
  })
  await waitFor(() => expect(result.current.isIdle).toBe(true))
  await act(async () => {
    onlineManager.setOnline(true)
    await client.resumePausedMutations()
  })
  expect(pending.state.status).toBe('error')
  expect(requests).toHaveLength(0)
  const key = notificationKeys.feed(next, 10)
  client.setQueryData(key, { pages: [], pageParams: [] })
  act(() => result.current.mutate('n1' as never))
  await waitFor(() => expect(requests).toHaveLength(1))
  await act(async () => {
    await publishCurrentUser(client, envelope(owner))
  })
  client.setQueryData(notificationKeys.feed(owner, 10), { pages: [], pageParams: [] })
  await act(async () => {
    requests[0]!.done.resolve(Response.json({ updated: 1 }))
  })
  await waitFor(() =>
    expect(client.getMutationCache().getAll().at(-1)!.state.status).toBe('success')
  )
  expect(client.getQueryState(key)).toBeUndefined()
  expect(client.getQueryState(notificationKeys.feed(owner, 10))?.isInvalidated).toBe(false)
  await act(async () => {
    await publishCurrentUser(client, envelope(null))
  })
  await waitFor(() => expect(result.current.isIdle).toBe(true))
  act(() => result.current.mutate('n1' as never))
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(requests).toHaveLength(1)
  unmount()
})

it.each(actions)(
  '%s acknowledges once before a held/failing GET and recovers with GET only',
  async (useAction) => {
    const { queryClient: client, Wrapper } = createWrapper()
    const requests = transportQueue()
    const unaffected = [
      notificationKeys.preferences(owner),
      notificationKeys.capabilities(),
      notificationKeys.feed({ ...owner, contextSession: 'other' }, 20),
    ]
    unaffected.forEach((key) => client.setQueryData(key, {}))
    client.setQueryData(notificationKeys.feed(owner, 10), { pages: [], pageParams: [] })
    const { result, unmount } = renderHook(
      // Read Query fields during render, as a component does, to subscribe to data changes.
      () => ({ write: useAction(owner), count: { ...useUnreadCount(owner) } }),
      { wrapper: Wrapper }
    )
    await waitFor(() => expect(requests).toHaveLength(1))
    act(() => result.current.write.mutate('n1' as never))
    await waitFor(() => expect(requests).toHaveLength(2))
    await act(async () => {
      requests[1]!.done.resolve(Response.json({ updated: 1 }))
    })
    await waitFor(() => expect(requests).toHaveLength(3))
    await waitFor(() => expect(result.current.write.isSuccess).toBe(true))
    expect(requests[0]!.signal?.aborted).toBe(true)
    expect(client.getQueryState(notificationKeys.feed(owner, 10))?.isInvalidated).toBe(true)
    unaffected.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(false))
    await act(async () => {
      requests[2]!.done.resolve(
        Response.json({ errorCode: 'SERVICE_UNAVAILABLE' }, { status: 503 })
      )
      requests[0]!.done.resolve(Response.json({ unread: 99 }))
    })
    await waitFor(() => expect(result.current.count.isError).toBe(true))
    expect(result.current.write.isSuccess).toBe(true)
    act(() => {
      void result.current.count.refetch()
    })
    await waitFor(() => expect(requests).toHaveLength(4))
    await act(async () => {
      requests[3]!.done.resolve(Response.json({ unread: 0 }))
    })
    await waitFor(() => expect(result.current.count.data?.unread).toBe(0))
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1)
    unmount()
  }
)
