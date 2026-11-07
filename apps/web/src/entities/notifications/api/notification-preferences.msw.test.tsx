import type { ReactNode } from 'react'
import type { NotificationPreferencesResponse } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'

import { currentUserKey } from '@/shared/api/query-session'
import { server } from '@/test/msw/server'

import {
  notificationKeys,
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from './notification-queries'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const owner = { userId: 'u1', contextSession: 'session-u1' }
const input = { category: 'account', channel: 'in_app', enabled: false }
const initial: NotificationPreferencesResponse = {
  notificationsEnabled: true,
  preferences: [{ ...input, enabled: true, mandatory: false }],
}
const updated: NotificationPreferencesResponse = {
  ...initial,
  preferences: [{ ...input, mandatory: false }],
}

it.each(['success', 'error'] as const)(
  'acknowledges PUT before delayed GET %s, without replaying the write',
  async (outcome) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(currentUserKey, {
      user: { id: owner.userId },
      contextSession: owner.contextSession,
    })
    client.setQueryData(notificationKeys.preferences(owner), initial)
    client.setQueryData(notificationKeys.unreadCount(owner), { unread: 1 })
    client.setQueryData(notificationKeys.feed(owner, 20), { data: [] })
    client.setQueryData(notificationKeys.capabilities(), { channels: [] })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const followup = Promise.withResolvers<void>()
    const writes: unknown[] = []
    let reads = 0
    server.use(
      http.put('/api/notifications/preferences', async ({ request }) => {
        writes.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('/api/notifications/preferences', async () => {
        reads += 1
        await followup.promise
        return outcome === 'error' && reads === 1
          ? HttpResponse.json({ errorCode: 'SERVICE_UNAVAILABLE' }, { status: 503 })
          : HttpResponse.json(updated)
      })
    )
    const { result, unmount } = renderHook(
      () => ({
        list: useNotificationPreferences(owner),
        save: useUpdateNotificationPreference(owner),
      }),
      { wrapper }
    )
    try {
      act(() => result.current.save.mutate(input))
      await waitFor(() => expect(reads).toBe(1))
      // The held GET cannot settle mutation success; only PUT acknowledgment can.
      await waitFor(() => expect(result.current.save.isSuccess).toBe(true))
      expect(result.current.save.isPending).toBe(false)
      expect(result.current.list.isFetching).toBe(true)
      expect(result.current.list.data).toEqual(initial)
      expect(writes).toEqual([input])
      await act(async () => followup.resolve())
      await waitFor(() => expect(result.current.list.isFetching).toBe(false))
      expect(result.current.save.isSuccess).toBe(true)
      expect(result.current.save.error).toBeNull()
      if (outcome === 'error') {
        expect(result.current.list.isError).toBe(true)
        expect(result.current.list.data).toEqual(initial)
        await act(async () => {
          await result.current.list.refetch()
        })
      }
      await waitFor(() => expect(result.current.list.data).toEqual(updated))
      expect(result.current.save.isSuccess).toBe(true)
      expect(writes).toEqual([input])
      expect(reads).toBe(outcome === 'error' ? 2 : 1)
      for (const key of [
        notificationKeys.unreadCount(owner),
        notificationKeys.feed(owner, 20),
        notificationKeys.capabilities(),
      ])
        expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    } finally {
      followup.resolve()
      unmount()
      client.clear()
    }
  }
)
