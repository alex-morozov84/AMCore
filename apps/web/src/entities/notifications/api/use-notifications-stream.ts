'use client'

import { notificationSseEventSchema } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { captureQuerySession, type QueryOwner, sameQueryOwner } from '@/shared/api/query-session'
import { useEventSource } from '@/shared/api/sse/use-event-source'

import { refreshNotificationFeed } from './notification-queries'

import 'client-only'

/**
 * Realtime in-app notification stream (ADR-053). Every event is a
 * content-free hint — "the feed or unread count changed" — never the
 * notification itself, so every reason just invalidates both; the durable
 * feed in Postgres stays the source of truth.
 */
export function useNotificationsStream(owner: QueryOwner | null, enabled = true): void {
  const queryClient = useQueryClient()

  const captured = captureQuerySession(queryClient)
  const admitted = sameQueryOwner(owner, captured.owner)
  const invalidate = () => {
    if (admitted) void refreshNotificationFeed(queryClient, captured)
  }

  useEventSource({
    url: '/api/notifications/stream',
    schema: notificationSseEventSchema,
    enabled: enabled && admitted,
    connectionKey: JSON.stringify([owner?.contextSession, owner?.userId]),
    onOpen: invalidate,
    onEvent: invalidate,
  })
}
