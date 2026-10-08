'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  type OrganizationAccessController,
  useRoleDefinitions,
} from '@/entities/organization-context'
import { CreateRoleDialog } from '@/features/role-editor'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { DebouncedSearchField } from '@/shared/ui/debounced-search-field'
import { FilterPanel } from '@/shared/ui/filter-panel'
import { ListPagination } from '@/shared/ui/list-pagination'

import { BuiltinRoles } from './builtin-roles'
import { RoleListSkeleton } from './role-list-skeleton'
import { RoleTable } from './role-table'

const PAGE_SIZE = 20
type Query = { page: number; search: string }

/**
 * Roles of one organization: built-in roles apart, editable roles in a table. Everything shown
 * requires the current read (`available`); a failed refresh hides stale rows and offers a retry.
 */
export function OrganizationRoles({
  controller,
  query,
  onQueryChange,
  onOpenRole,
}: {
  controller: OrganizationAccessController
  query: Query
  onQueryChange: (query: Query, reason: 'search' | 'page') => void
  onOpenRole: (roleId: string) => void
}) {
  const t = useTranslations('organizationRoles')
  const roles = useRoleDefinitions(controller, query)
  const [navigation, setNavigation] = useState(0)
  const totalPages = Math.max(1, Math.ceil((roles.data?.total ?? 0) / PAGE_SIZE))
  const recoveringPage = Boolean(roles.available && query.page > totalPages)
  useRecoverPage(roles.available, query, totalPages, (next) => {
    setNavigation((value) => value + 1)
    onQueryChange(next, 'page')
  })
  const data = roles.available ? roles.data : undefined
  const builtin = data?.data.filter((role) => role.isSystem) ?? []
  const custom = data?.data.filter((role) => !role.isSystem) ?? []
  const go = (page: number) => {
    setNavigation((value) => value + 1)
    onQueryChange({ ...query, page }, 'page')
  }
  return (
    <div className="space-y-4">
      <h2 className="sr-only">{t('title')}</h2>
      <FilterPanel>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
            <DebouncedSearchField
              identity={JSON.stringify([controller.binding, controller.organizationId, navigation])}
              search={query.search}
              page={query.page}
              id="organization-role-search"
              label={t('search')}
              placeholder={t('searchPlaceholder')}
              clearLabel={t('clear')}
              maxLength={100}
              onCommit={(search) => onQueryChange({ search, page: 1 }, 'search')}
            />
          </div>
          <CreateRoleDialog
            controller={controller}
            disabled={!roles.ready}
            onCreated={onOpenRole}
            onSearchName={(search) => onQueryChange({ search, page: 1 }, 'search')}
          />
        </div>
      </FilterPanel>
      <ApiErrorAlert error={roles.error} />
      {Boolean(roles.error) && (
        <div className="space-y-2">
          <p role="status">{t('readUnavailable')}</p>
          <Button
            variant="outline"
            disabled={roles.retryAt !== undefined || roles.busy}
            onClick={() => void controller.refresh().catch(() => undefined)}
          >
            {t('retry')}
          </Button>
        </div>
      )}
      <div aria-busy={!roles.error && !data}>
        {roles.error ? null : !data || recoveringPage ? (
          <RoleListSkeleton />
        ) : (
          <div className="space-y-6">
            <p aria-live="polite" className="text-sm text-foreground-muted">
              {t('count', { count: data.total })}
            </p>
            <BuiltinRoles rows={builtin} />
            <CustomRoles rows={custom} search={query.search} />
          </div>
        )}
      </div>
      {data && !recoveringPage && totalPages > 1 && (
        <ListPagination
          status={t('pageStatus', { page: query.page, totalPages })}
          previous={
            query.page > 1 ? (
              <Button variant="outline" size="sm" onClick={() => go(query.page - 1)}>
                {t('previous')}
              </Button>
            ) : undefined
          }
          next={
            query.page < totalPages ? (
              <Button variant="outline" size="sm" onClick={() => go(query.page + 1)}>
                {t('next')}
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}

function CustomRoles({
  rows,
  search,
}: {
  rows: React.ComponentProps<typeof RoleTable>['rows']
  search: string
}) {
  const t = useTranslations('organizationRoles')
  return (
    <section aria-labelledby="custom-roles-title" className="space-y-2">
      <h3 id="custom-roles-title" className="text-base font-semibold">
        {t('customTitle')}
      </h3>
      {rows.length > 0 ? (
        <RoleTable rows={rows} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {search ? t('emptySearch') : t('customEmpty')}
        </p>
      )}
    </section>
  )
}

/** A page past the end (rows were deleted elsewhere) moves to the last page once per identity. */
function useRecoverPage(
  available: boolean,
  query: Query,
  totalPages: number,
  move: (query: Query) => void
) {
  const recovered = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!available) return
    const identity = JSON.stringify([query.search, query.page, totalPages])
    if (query.page <= totalPages) {
      recovered.current = undefined
      return
    }
    if (recovered.current === identity) return
    recovered.current = identity
    move({ ...query, page: totalPages })
  }, [available, query, totalPages, move])
}
