import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

// eslint-disable-next-line boundaries/dependencies -- Integration fixture uses the actual subscribed bootstrap with notification consumers.
import { useCurrentUser } from '@/entities/user'
import {
  currentUserKey,
  publishCurrentUser,
  queryOwner,
  type UserEnvelope,
} from '@/shared/api/query-session'

import { notificationKeys, useNotificationsFeed, useUnreadCount } from './notification-queries'
import { useNotificationsStream } from './use-notifications-stream'

class Source {
  static instances: Source[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  closed = false
  constructor(
    public url: string,
    public init: EventSourceInit
  ) {
    Source.instances.push(this)
  }
  close() {
    this.closed = true
  }
}
const owner = { userId: 'a', contextSession: 's1' }
const frame = {
  data: JSON.stringify({ eventId: 'e1', reason: 'unread_changed' }),
} as MessageEvent<string>
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Source.instances = []
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(currentUserKey, {
    user: { id: owner.userId },
    contextSession: owner.contextSession,
  })
  const pending: {
    signal?: AbortSignal | null
    done: ReturnType<typeof Promise.withResolvers<Response>>
  }[] = []
  vi.stubGlobal('EventSource', Source)
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const done = Promise.withResolvers<Response>()
      pending.push({ signal: init.signal, done })
      return done.promise
    })
  )
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, pending, wrapper }
}

it.each(['open', 'message'] as const)('replaces pending initial GETs after %s', async (event) => {
  const { client, pending, wrapper } = setup()
  const untouched = [
    notificationKeys.preferences(owner),
    notificationKeys.capabilities(),
    notificationKeys.feed({ ...owner, contextSession: 'other' }, 20),
    ['personal', 's1', 'a', 'sessions'],
  ]
  untouched.forEach((key) => client.setQueryData(key, {}))
  client.setQueryData(notificationKeys.feed(owner, 10), { pages: [], pageParams: [] })
  const { result, unmount } = renderHook(
    () => {
      useNotificationsStream(owner)
      return { feed: useNotificationsFeed(owner, 20), count: useUnreadCount(owner) }
    },
    { wrapper }
  )
  await waitFor(() => expect(pending).toHaveLength(2))
  const source = Source.instances[0]!
  expect(source.url).toBe('/api/notifications/stream')
  expect(source.init).toEqual({ withCredentials: true })
  act(() => (event === 'open' ? source.onopen?.() : source.onmessage?.(frame)))
  await waitFor(() => expect(pending).toHaveLength(4))
  expect(pending.slice(0, 2).every((p) => p.signal?.aborted)).toBe(true)
  const finish = async (start: number, unread: number) =>
    act(async () => {
      pending[start]!.done.resolve(
        Response.json({ data: [{ id: String(unread) }], nextCursor: null, hasMore: false })
      )
      pending[start + 1]!.done.resolve(Response.json({ unread }))
    })
  await finish(2, 2)
  await waitFor(() => expect(result.current.count.data).toEqual({ unread: 2 }))
  await finish(0, 1)
  expect(result.current.count.data).toEqual({ unread: 2 })
  expect(result.current.feed.data?.pages[0]?.data[0]?.id).toBe('2')
  expect(client.getQueryState(notificationKeys.feed(owner, 20))?.isInvalidated).toBe(false)
  expect(client.getQueryState(notificationKeys.feed(owner, 10))?.isInvalidated).toBe(true)
  untouched.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(false))
  unmount()
})

it.each(['other-user', 'same-user'])(
  'keeps retired refresh continuations out of %s',
  async (kind) => {
    const { client, pending, wrapper } = setup()
    const next = {
      user: { id: kind === 'other-user' ? 'b' : 'a' },
      contextSession: 's2',
    } as UserEnvelope
    const { unmount, rerender } = renderHook(
      () => {
        const active = queryOwner(useCurrentUser().data)
        useNotificationsStream(active ? { ...active } : null)
        useUnreadCount(active)
      },
      { wrapper }
    )
    await waitFor(() => expect(pending).toHaveLength(1))
    rerender()
    expect(Source.instances).toHaveLength(1)
    const old = Source.instances[0]!
    const savedOpen = old.onopen!
    const savedMessage = old.onmessage!
    const gate = Promise.withResolvers<void>()
    const cancelled = Promise.withResolvers<void>()
    const cancel = client.cancelQueries.bind(client)
    vi.spyOn(client, 'cancelQueries').mockImplementationOnce(async (...args) => {
      await cancel(...args)
      cancelled.resolve()
      await gate.promise
    })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    act(() => savedOpen())
    await cancelled.promise
    await act(async () => {
      await publishCurrentUser(client, next)
    })
    await waitFor(() => expect(Source.instances).toHaveLength(2))
    expect(old.closed).toBe(true)
    await act(async () => {
      gate.resolve()
      savedOpen()
      savedMessage(frame)
    })
    expect(invalidate).not.toHaveBeenCalled()
    expect(client.getQueryState(notificationKeys.unreadCount(owner))).toBeUndefined()
    const current = Source.instances[1]!
    act(() => current.onopen?.())
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: notificationKeys.owned(queryOwner(next)),
      })
    )
    await act(async () => {
      await publishCurrentUser(client, { user: null })
    })
    await waitFor(() => expect(current.closed).toBe(true))
    expect(Source.instances).toHaveLength(2)
    unmount()
  }
)
