'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import type { AdminSessionsListResponse, SupportedLocale } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { consoleApi } from '@/shared/api/console-api'
import { useClampPage } from '@/shared/lib/use-clamp-page'

const PAGE_SIZE = 20
/** The locale segment's fixed index in `userSessionsKeys.list(...)`'s key shape. */
const LOCALE_KEY_INDEX = 3

export const userSessionsKeys = {
  /** Prefix shared by every locale/page variant for one target user — pass
   * this to `invalidateQueries` after a revoke. */
  all: (userId: string) => ['console', 'userSessions', userId] as const,
  list: (userId: string, locale: SupportedLocale, page: number, limit: number) =>
    [...userSessionsKeys.all(userId), locale, page, limit] as const,
}

/**
 * Client-side interactive leaf inside the still-server-rendered User Detail
 * page: its own local, non-URL-synced pagination (not `DetailPager`, which
 * is owned by Memberships' server/URL-driven page+search state and is not a
 * drop-in for client-Query paging). Page resets to 1 automatically whenever
 * `userId` changes because the page composition keys the whole card by userId; see the same locale-switch-safe
 * `placeholderData` pattern already established in `entities/user`'s
 * self-service `useSessions`.
 */
export function useUserSessions(userId: string) {
  const locale = useLocale() as SupportedLocale
  const [page, setPage] = useState(1)

  const query = useQuery({
    queryKey: userSessionsKeys.list(userId, locale, page, PAGE_SIZE),
    queryFn: () => consoleApi.getUserSessions(userId, page, PAGE_SIZE, locale),
    placeholderData: (previousData: AdminSessionsListResponse | undefined, previousQuery) =>
      previousQuery?.queryKey[2] === userId && previousQuery.queryKey[LOCALE_KEY_INDEX] === locale
        ? previousData
        : undefined,
  })

  useClampPage(page, setPage, query.data?.total, PAGE_SIZE)

  return { ...query, page, setPage, pageSize: PAGE_SIZE }
}
