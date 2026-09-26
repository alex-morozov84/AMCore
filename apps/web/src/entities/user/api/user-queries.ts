import { useLocale } from 'next-intl'
import type { SessionsListResponse, SupportedLocale, UserResponse } from '@amcore/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authApi } from '@/shared/api'

export const userKeys = {
  all: ['user'] as const,
  me: () => [...userKeys.all, 'me'] as const,
  // Prefix shared by every `sessions(locale, page, limit)` variant — pass
  // this to `invalidateQueries` after a revoke to match every locale/page/
  // limit variant at once without also invalidating `me()`.
  sessionsAll: () => [...userKeys.all, 'sessions'] as const,
  sessions: (locale: SupportedLocale, page: number, limit: number) =>
    [...userKeys.sessionsAll(), locale, page, limit] as const,
}

/** The locale segment's fixed index in `userKeys.sessions(...)`'s key shape. */
const SESSIONS_KEY_LOCALE_INDEX = 2

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
 * whichever page is asked for. `useLocale()` is read here — a hook — not
 * inside `authApi.getSessions` itself (a plain function, where calling a
 * hook would violate the rules of hooks); the resolved locale is passed
 * down as a plain argument.
 *
 * The custom `placeholderData` below is a locale-aware variant of
 * `keepPreviousData`: the built-in helper would reuse the *previous*
 * query's data across ANY key change, including a locale switch, which
 * would flash a still-loading page's location column with the previous
 * locale's city name for a moment. Reusing previous data stays correct
 * for an ordinary same-locale page change; it must not survive a locale
 * change, so switching locale falls through to the ordinary loading state.
 */
export function useSessions(page: number, limit: number) {
  const locale = useLocale() as SupportedLocale

  return useQuery({
    queryKey: userKeys.sessions(locale, page, limit),
    queryFn: () => authApi.getSessions(page, limit, locale),
    staleTime: 60 * 1000, // 1 minute
    placeholderData: (previousData: SessionsListResponse | undefined, previousQuery) =>
      previousQuery?.queryKey[SESSIONS_KEY_LOCALE_INDEX] === locale ? previousData : undefined,
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
