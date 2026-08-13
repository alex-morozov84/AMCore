import type {
  UpdateNotificationPreferenceInput,
  UpdateNotificationSettingsInput,
} from '@amcore/shared'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { notificationsApi } from './notifications-api'

export const notificationKeys = {
  all: ['notifications'] as const,
  // Prefix shared by every `feed(limit)` variant — invalidate this, not a
  // specific limit, so a mutation refreshes the feed regardless of which
  // page size the caller happens to be viewing.
  feedAll: () => [...notificationKeys.all, 'feed'] as const,
  feed: (limit: number) => [...notificationKeys.feedAll(), limit] as const,
  unreadCount: () => [...notificationKeys.all, 'unreadCount'] as const,
  preferences: () => [...notificationKeys.all, 'preferences'] as const,
  capabilities: () => [...notificationKeys.all, 'capabilities'] as const,
}

/** Cursor-paginated feed (ADR-036 keyset pagination, not offset). */
export function useNotificationsFeed(limit = 20) {
  return useInfiniteQuery({
    queryKey: notificationKeys.feed(limit),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      notificationsApi.getFeed(pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  })
}

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => notificationsApi.getUnreadCount(),
    staleTime: 30 * 1000,
  })
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: () => notificationsApi.getPreferences(),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * The active channel/category registry (ADR-052) — a preferences UI reads
 * this to render which channels/categories exist and which are
 * user-overridable, instead of hardcoding a dead or incomplete set.
 */
export function useNotificationCapabilities() {
  return useQuery({
    queryKey: notificationKeys.capabilities(),
    queryFn: () => notificationsApi.getCapabilities(),
    staleTime: 5 * 60 * 1000,
  })
}

/** Invalidates the feed + unread count after any mutation that changes read/archived state. */
function useInvalidateFeedAndUnread() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: notificationKeys.feedAll() })
    queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() })
  }
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidateFeedAndUnread()
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  })
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateFeedAndUnread()
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  })
}

export function useArchiveNotification() {
  const invalidate = useInvalidateFeedAndUnread()
  return useMutation({
    mutationFn: (id: string) => notificationsApi.archive(id),
    onSuccess: invalidate,
  })
}

export function useUpdateNotificationPreference() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateNotificationPreferenceInput) =>
      notificationsApi.updatePreference(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.preferences() }),
  })
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateNotificationSettingsInput) => notificationsApi.updateSettings(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.preferences() }),
  })
}
