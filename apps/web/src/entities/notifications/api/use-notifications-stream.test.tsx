import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useEventSource } from '@/shared/api/sse/use-event-source'

import { notificationKeys } from './notification-queries'
import { useNotificationsStream } from './use-notifications-stream'

vi.mock('@/shared/api/sse/use-event-source', () => ({ useEventSource: vi.fn() }))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, Wrapper }
}

describe('useNotificationsStream', () => {
  it('connects to the relative same-origin BFF stream route', () => {
    const { Wrapper } = createWrapper()

    renderHook(() => useNotificationsStream(), { wrapper: Wrapper })

    expect(vi.mocked(useEventSource)).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/notifications/stream', enabled: true })
    )
  })

  it('invalidates the feed and unread count on open and on every event', () => {
    const { queryClient, Wrapper } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderHook(() => useNotificationsStream(), { wrapper: Wrapper })

    const options = vi.mocked(useEventSource).mock.calls[0]![0]
    options.onOpen?.()
    options.onEvent({ eventId: 'e1', reason: 'created' })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: notificationKeys.feedAll() })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: notificationKeys.unreadCount() })
    expect(invalidateSpy.mock.calls.length).toBe(4) // onOpen + onEvent, each invalidates 2 keys
  })
})
