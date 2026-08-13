'use client'

import { notificationSseEventSchema } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { useEventSource } from '@/shared/api/sse/use-event-source'

import { notificationKeys } from './notification-queries'

import 'client-only'

/**
 * Realtime in-app notification stream (ADR-053). Every event is a
 * content-free hint — "the feed or unread count changed" — never the
 * notification itself, so every reason just invalidates both; the durable
 * feed in Postgres stays the source of truth.
 */
export function useNotificationsStream(enabled = true): void {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: notificationKeys.feedAll() })
    queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() })
  }

  useEventSource({
    url: '/api/notifications/stream',
    schema: notificationSseEventSchema,
    enabled,
    onOpen: invalidate,
    onEvent: invalidate,
  })
}
