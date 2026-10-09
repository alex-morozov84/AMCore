'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  type OrganizationAccessController,
  type OrganizationContextState,
  useOrganizationMembers,
} from '@/entities/organization-context'
import { MemberAccessDialog } from '@/features/member-access'
import { MemberRoleDialog, MemberSearch } from '@/features/member-role-assignment'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { FilterPanel } from '@/shared/ui/filter-panel'
import { ListPagination } from '@/shared/ui/list-pagination'

import { MemberListSkeleton } from './member-list-skeleton'
import { MemberTable } from './member-table'
import { RoleFilter } from './role-filter'

type MemberListQuery = { page: number; search: string; roleId?: string }

export function OrganizationMembers({
  controller,
  actorId,
  query: controlledQuery,
  onQueryChange,
  authorityStatus,
}: {
  controller: OrganizationAccessController
  actorId: string
  authorityStatus?: OrganizationContextState['status']
  query?: MemberListQuery
  onQueryChange?: (query: MemberListQuery, reason: 'search' | 'page') => void
}) {
  const t = useTranslations('organizationMembers')
  const heading = useRef<HTMLHeadingElement>(null)
  const [localQuery, setLocalQuery] = useState<MemberListQuery>({ page: 1, search: '' })
  const query = controlledQuery ?? localQuery
  const setQuery = useCallback(
    (next: typeof localQuery, reason: 'search' | 'page' = 'search') => {
      if (onQueryChange) onQueryChange(next, reason)
      else setLocalQuery(next)
    },
    [onQueryChange]
  )
  const [navigation, setNavigation] = useState(0)
  const members = useOrganizationMembers(controller, query)
  const authorityUnavailable =
    authorityStatus !== undefined && authorityStatus !== 'pending' && authorityStatus !== 'ready'
  const totalPages = Math.max(1, Math.ceil((members.data?.total ?? 0) / 20))
  const recoveringPage = Boolean(members.data && query.page > totalPages)
  const navigatePage = (page: number) => {
    setNavigation((value) => value + 1)
    setQuery({ ...query, page }, 'page')
  }
  const recovered = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!members.ready || members.pending || members.error || !members.data) return
    const identity = JSON.stringify([
      controller.binding,
      controller.organizationId,
      query.search,
      query.page,
      totalPages,
    ])
    if (query.page <= totalPages) {
      recovered.current = undefined
      return
    }
    if (recovered.current === identity) return
    recovered.current = identity
    setNavigation((value) => value + 1)
    setQuery({ ...query, page: totalPages }, 'page')
  }, [
    controller,
    members.ready,
    members.pending,
    members.error,
    members.data,
    query,
    totalPages,
    setQuery,
  ])
  const [userId, setUserId] = useState<string>()
  const [accessUserId, setAccessUserId] = useState<string>()
  return (
    <div className="space-y-4">
      <h2 className="sr-only" ref={heading} tabIndex={-1}>
        {t('title')}
      </h2>
      <FilterPanel>
        <MemberSearch
          identity={JSON.stringify([
            controller.binding,
            controller.organizationId,
            'members',
            navigation,
          ])}
          search={query.search}
          page={query.page}
          id="organization-member-search"
          placeholder={t('memberSearchPlaceholder')}
          onCommit={(search) => setQuery({ ...query, search, page: 1 })}
        />
        {query.roleId && (
          <RoleFilter
            controller={controller}
            roleId={query.roleId}
            onClear={() => setQuery({ search: query.search, page: 1 })}
          />
        )}
      </FilterPanel>
      <ApiErrorAlert error={members.error} />
      {Boolean(members.error) && (
        <Button
          variant="outline"
          disabled={members.retryAt !== undefined || members.busy}
          onClick={() => void controller.refresh().catch(() => undefined)}
        >
          {t('retry')}
        </Button>
      )}
      {members.ready && members.data && !members.pending && !members.error && !recoveringPage && (
        <p aria-live="polite" className="text-sm text-foreground-muted">
          {t('count', { count: members.data.total })}
        </p>
      )}
      <div
        aria-busy={!authorityUnavailable && (members.pending || !members.ready || recoveringPage)}
      >
        {authorityUnavailable || members.error ? null : members.pending || recoveringPage ? (
          <MemberListSkeleton />
        ) : !members.ready ? (
          authorityStatus === undefined ||
          authorityStatus === 'pending' ||
          authorityStatus === 'ready' ? (
            <MemberListSkeleton />
          ) : null
        ) : members.data && members.data.data.length > 0 ? (
          <MemberTable
            rows={members.data.data}
            actorId={actorId}
            disabled={!members.ready || members.busy}
            onEdit={setUserId}
            onAccess={setAccessUserId}
          />
        ) : members.data ? (
          <p>{t('empty')}</p>
        ) : null}
      </div>
      {members.ready && members.data && !members.error && !recoveringPage && totalPages > 1 && (
        <ListPagination
          status={t('pageStatus', { page: query.page, totalPages })}
          previous={
            query.page > 1 ? (
              <Button
                variant="outline"
                size="sm"
                disabled={members.pending}
                onClick={() => navigatePage(query.page - 1)}
              >
                {t('previous')}
              </Button>
            ) : undefined
          }
          next={
            query.page < totalPages ? (
              <Button
                variant="outline"
                size="sm"
                disabled={members.pending}
                onClick={() => navigatePage(query.page + 1)}
              >
                {t('next')}
              </Button>
            ) : undefined
          }
        />
      )}
      {userId && (
        <MemberRoleDialog
          key={userId}
          controller={controller}
          actorId={actorId}
          userId={userId}
          onClose={() => {
            setUserId(undefined)
            heading.current?.focus()
          }}
        />
      )}
      {accessUserId && (
        <MemberAccessDialog
          key={accessUserId}
          controller={controller}
          userId={accessUserId}
          onClose={() => {
            setAccessUserId(undefined)
            heading.current?.focus()
          }}
        />
      )}
    </div>
  )
}
