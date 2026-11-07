import type {
  UpdateNotificationPreferenceInput,
  UpdateNotificationSettingsInput,
} from '@amcore/shared'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ClientErrorCode, ClientStateError } from '@/shared/api/error-codes'
import {
  captureQuerySession,
  isCurrentQuerySession,
  personalKey,
  type QueryOwner,
  sameQueryOwner,
} from '@/shared/api/query-session'

import { notificationsApi } from './notifications-api'

export const notificationKeys = {
  all: ['notifications'] as const, // Registry only; excludes owned feed/count/preferences.
  // Prefix shared by every `feed(limit)` variant — invalidate this, not a
  // specific limit, so a mutation refreshes the feed regardless of which
  // page size the caller happens to be viewing.
  owned: (owner: QueryOwner | null) => [...personalKey(owner), 'notifications'] as const,
  feedAll: (owner: QueryOwner | null) => [...notificationKeys.owned(owner), 'feed'] as const,
  feed: (owner: QueryOwner | null, limit: number) =>
    [...notificationKeys.feedAll(owner), limit] as const,
  unreadCount: (owner: QueryOwner | null) =>
    [...notificationKeys.owned(owner), 'unreadCount'] as const,
  preferences: (owner: QueryOwner | null) =>
    [...personalKey(owner), 'notification-preferences'] as const,
  capabilities: () => [...notificationKeys.all, 'capabilities'] as const,
}

/** Cursor-paginated feed (ADR-036 keyset pagination, not offset). */
export function useNotificationsFeed(owner: QueryOwner | null, limit = 20) {
  const client = useQueryClient()
  return useInfiniteQuery({
    queryKey: notificationKeys.feed(owner, limit),
    enabled: !!owner,
    queryFn: ({ pageParam, signal }) => {
      requireOwner(client, owner)
      return notificationsApi.getFeed(pageParam, limit, signal)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  })
}

export function useUnreadCount(owner: QueryOwner | null) {
  const client = useQueryClient()
  return useQuery({
    queryKey: notificationKeys.unreadCount(owner),
    enabled: !!owner,
    queryFn: ({ signal }) => {
      requireOwner(client, owner)
      return notificationsApi.getUnreadCount(signal)
    },
    staleTime: 30 * 1000,
  })
}

export function useNotificationPreferences(owner: QueryOwner | null) {
  const client = useQueryClient()
  return useQuery({
    queryKey: notificationKeys.preferences(owner),
    enabled: !!owner,
    queryFn: () => {
      requireOwner(client, owner)
      return notificationsApi.getPreferences()
    },
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

/** Shared by confirmed writes and stream hints; never adopts a replacement owner. */
export async function refreshNotificationFeed(
  client: ReturnType<typeof useQueryClient>,
  captured: ReturnType<typeof captureQuerySession>
) {
  if (!isCurrentQuerySession(client, captured)) return
  const filter = { queryKey: notificationKeys.owned(captured.owner) }
  await client.cancelQueries(filter)
  if (isCurrentQuerySession(client, captured)) void client.invalidateQueries(filter)
}

export function useMarkNotificationRead(owner: QueryOwner | null) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...notificationKeys.owned(owner), 'mark-read'],
    mutationFn: (id: string) => {
      requireOwner(client, owner)
      return notificationsApi.markRead(id)
    },
    onMutate: () => requireOwner(client, owner),
    onSuccess: (_response, _input, captured) => {
      void refreshNotificationFeed(client, captured)
    },
  })
}

export function useMarkAllNotificationsRead(owner: QueryOwner | null) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...notificationKeys.owned(owner), 'mark-all'],
    mutationFn: () => {
      requireOwner(client, owner)
      return notificationsApi.markAllRead()
    },
    onMutate: () => requireOwner(client, owner),
    onSuccess: (_response, _input, captured) => {
      void refreshNotificationFeed(client, captured)
    },
  })
}

export function useArchiveNotification(owner: QueryOwner | null) {
  const client = useQueryClient()
  return useMutation({
    mutationKey: [...notificationKeys.owned(owner), 'archive'],
    mutationFn: (id: string) => {
      requireOwner(client, owner)
      return notificationsApi.archive(id)
    },
    onMutate: () => requireOwner(client, owner),
    onSuccess: (_response, _input, captured) => {
      void refreshNotificationFeed(client, captured)
    },
  })
}

function requireOwner(client: ReturnType<typeof useQueryClient>, owner: QueryOwner | null) {
  const captured = captureQuerySession(client)
  if (!sameQueryOwner(owner, captured.owner))
    throw new ClientStateError(ClientErrorCode.AUTH_CONTINUATION_CHANGED)
  return captured
}

export function useUpdateNotificationPreference(owner: QueryOwner | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateNotificationPreferenceInput) =>
      notificationsApi.updatePreference(input),
    onMutate: () => requireOwner(queryClient, owner),
    onSuccess: (_response, _input, captured) => {
      if (isCurrentQuerySession(queryClient, captured))
        void queryClient.invalidateQueries({
          queryKey: notificationKeys.preferences(captured!.owner),
        })
    },
  })
}

export function useUpdateNotificationSettings(owner: QueryOwner | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateNotificationSettingsInput) => notificationsApi.updateSettings(input),
    onMutate: () => requireOwner(queryClient, owner),
    onSuccess: (_response, _input, captured) => {
      if (isCurrentQuerySession(queryClient, captured))
        void queryClient.invalidateQueries({
          queryKey: notificationKeys.preferences(captured!.owner),
        })
    },
  })
}
