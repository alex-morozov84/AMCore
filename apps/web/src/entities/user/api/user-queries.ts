import type { UserResponse } from '@amcore/shared'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authApi } from '@/shared/api'

export const userKeys = {
  all: ['user'] as const,
  me: () => [...userKeys.all, 'me'] as const,
  // Prefix shared by every `sessions(page, limit)` variant — pass this to
  // `invalidateQueries` after a revoke to match all pages/limits at once
  // without also invalidating `me()`.
  sessionsAll: () => [...userKeys.all, 'sessions'] as const,
  sessions: (page: number, limit: number) => [...userKeys.sessionsAll(), page, limit] as const,
}

export function useCurrentUser() {
  return useQuery({
    queryKey: userKeys.me(),
    queryFn: () => authApi.getMe(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  })
}

/**
 * `page`/`limit` are plain query-key params, not a TanStack Table
 * client-side pagination feature — the backend already paginates
 * server-side (`sessionsListResponseSchema`); this hook just fetches
 * whichever page is asked for. `keepPreviousData` avoids a loading flash
 * between pages.
 */
export function useSessions(page: number, limit: number) {
  return useQuery({
    queryKey: userKeys.sessions(page, limit),
    queryFn: () => authApi.getSessions(page, limit),
    staleTime: 60 * 1000, // 1 minute
    placeholderData: keepPreviousData,
  })
}

/**
 * Merges `avatarUrl` into the cached current user rather than invalidating
 * `me()` — the upload response carries only the new URL, and the current
 * user is already in cache from the mount that renders whatever triggers
 * this upload.
 */
function setCachedAvatarUrl(
  queryClient: ReturnType<typeof useQueryClient>,
  avatarUrl: string | null
): void {
  queryClient.setQueryData<{ user: UserResponse | null }>(userKeys.me(), (old) =>
    old?.user ? { user: { ...old.user, avatarUrl } } : old
  )
}

export function useUploadAvatar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => authApi.uploadAvatar(file),
    onSuccess: (response) => setCachedAvatarUrl(queryClient, response.avatarUrl),
  })
}

export function useDeleteAvatar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => authApi.deleteAvatar(),
    onSuccess: () => setCachedAvatarUrl(queryClient, null),
  })
}
