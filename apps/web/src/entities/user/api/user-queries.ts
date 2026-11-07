import { useLocale } from 'next-intl'
import type { CatalogueLocale, SessionsListResponse } from '@amcore/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authApi } from '@/shared/api'
import { ClientErrorCode, ClientStateError } from '@/shared/api/error-codes'
import {
  captureQuerySession,
  currentUserKey,
  isCurrentQuerySession,
  personalKey,
  type QueryOwner,
  queryOwner,
  retirePersonalQueries,
  sameQueryOwner,
  type UserEnvelope,
} from '@/shared/api/query-session'

export const userKeys = {
  all: ['user'] as const, // Bootstrap only; owned sessions use sessionsAll(owner).
  me: () => currentUserKey,
  // Prefix shared by every `sessions(owner, locale, page, limit)` variant — pass
  // this to `invalidateQueries` after a revoke to match every locale/page/
  // limit variant at once without also invalidating `me()`.
  sessionsAll: (owner: QueryOwner | null) => [...personalKey(owner), 'sessions'] as const,
  sessions: (owner: QueryOwner | null, locale: CatalogueLocale, page: number, limit: number) =>
    [...userKeys.sessionsAll(owner), locale, page, limit] as const,
}

/** The locale segment's fixed index in `userKeys.sessions(...)`'s key shape. */
const SESSIONS_KEY_LOCALE_INDEX = 4

export function useCurrentUser() {
  const client = useQueryClient()
  return useQuery({
    queryKey: userKeys.me(),
    queryFn: async ({ signal }) => {
      const envelope = await authApi.getMe(signal)
      signal.throwIfAborted()
      await retirePersonalQueries(client, queryOwner(envelope), () => !signal.aborted)
      signal.throwIfAborted()
      return envelope
    },
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
 * The custom `placeholderData` below is an owner/session/locale-aware variant of
 * `keepPreviousData`: the built-in helper would reuse the *previous*
 * query's data across ANY key change, including a locale switch, which
 * would flash a still-loading page's location column with the previous
 * locale's city name for a moment. Reusing previous data stays correct
 * for a page change within the same owner, session and locale; an identity or locale
 * change falls through to the ordinary loading state.
 */
export function useSessions(page: number, limit: number) {
  const locale = useLocale() as CatalogueLocale
  const client = useQueryClient()
  const me = useCurrentUser()
  const owner = queryOwner(me.data)

  const list = useQuery({
    queryKey: userKeys.sessions(owner, locale, page, limit),
    enabled: !!owner,
    queryFn: () => {
      if (!sameQueryOwner(owner, captureQuerySession(client).owner))
        throw new ClientStateError(ClientErrorCode.AUTH_CONTINUATION_CHANGED)
      return authApi.getSessions(page, limit, locale)
    },
    staleTime: 60 * 1000, // 1 minute
    placeholderData: (previousData: SessionsListResponse | undefined, previousQuery) =>
      owner &&
      previousQuery?.queryKey[1] === owner.contextSession &&
      previousQuery.queryKey[2] === owner.userId &&
      previousQuery.queryKey[SESSIONS_KEY_LOCALE_INDEX] === locale
        ? previousData
        : undefined,
  })
  const waiting = !owner && (me.isPending || me.isFetching)
  return {
    data: owner ? list.data : undefined,
    error: owner
      ? list.error
      : waiting
        ? null
        : (me.error ?? new ClientStateError(ClientErrorCode.AUTH_CONTINUATION_CHANGED)),
    isPending: owner ? list.isPending : waiting,
    isFetching: owner ? list.isFetching : me.isFetching,
    isError: owner ? list.isError : !waiting,
    isSuccess: !!owner && list.isSuccess,
    refetch: async () => {
      if (owner) await list.refetch()
      else await me.refetch()
    },
  }
}

/**
 * Merges `avatarUrl` into the cached current user rather than invalidating
 * `me()` — the upload response carries only the new URL, and the current
 * user is already in cache from the mount that renders whatever triggers
 * this upload.
 */
function setCachedAvatarUrl(
  queryClient: ReturnType<typeof useQueryClient>,
  avatarUrl: string | null,
  captured: ReturnType<typeof captureQuerySession> | undefined
): void {
  if (!isCurrentQuerySession(queryClient, captured)) return
  queryClient.setQueryData<UserEnvelope>(userKeys.me(), (old) =>
    old?.user ? { ...old, user: { ...old.user, avatarUrl } } : old
  )
}

export function useUploadAvatar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => authApi.uploadAvatar(file),
    onMutate: () => captureQuerySession(queryClient),
    onSuccess: (response, _file, captured) =>
      setCachedAvatarUrl(queryClient, response.avatarUrl, captured),
  })
}

export function useDeleteAvatar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => authApi.deleteAvatar(),
    onMutate: () => captureQuerySession(queryClient),
    onSuccess: (_response, _input, captured) => setCachedAvatarUrl(queryClient, null, captured),
  })
}
