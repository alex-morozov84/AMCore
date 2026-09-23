import { getFormatter, getTranslations } from 'next-intl/server'
import type { AdminUserResponse, AdminUserSortField } from '@amcore/shared'

import {
  type DiscoveryQueryState,
  type DiscoverySortOrder,
  SortableColumnHead,
  toggleSortOrder,
} from '@/features/console-discovery'
import { getConsoleAwareUser } from '@/shared/api/console/access-token'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import { USERS_DEFAULT_SORT_ORDER, type UsersSortableField } from './parse-query'
import { UserRow } from './UserRow'

const MONO = 'font-console-mono'

export interface UsersTableProps {
  users: AdminUserResponse[]
  baseHref: string
  search?: string
  sortBy: AdminUserSortField
  sortOrder?: DiscoverySortOrder
}

export async function UsersTable({ users, baseHref, search, sortBy, sortOrder }: UsersTableProps) {
  const t = await getTranslations('console')
  const format = await getFormatter()
  // The signed-in operator's own row never gets a role action (server also
  // refuses it — see `admin.service.ts`'s self-change guard — this only
  // avoids offering a guaranteed-to-fail one).
  const operator = await getConsoleAwareUser()
  const current: Pick<DiscoveryQueryState, 'search' | 'sortBy' | 'sortOrder'> = {
    search,
    sortBy,
    sortOrder,
  }

  function accessibleSortLabel(
    column: UsersSortableField,
    defaultOrder: DiscoverySortOrder,
    visibleLabel: string
  ) {
    const nextOrder = toggleSortOrder(column, current, defaultOrder)
    return t('sortColumnAction', {
      column: visibleLabel,
      direction: t(nextOrder === 'asc' ? 'sortAscending' : 'sortDescending'),
    })
  }

  const userColumnLabel = t('usersColumnUser')
  const lastLoginColumnLabel = t('usersColumnLastLogin')
  const createdColumnLabel = t('usersColumnCreated')
  const updatedColumnLabel = t('usersColumnUpdated')

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated shadow-md">
      <Table>
        <TableHeader>
          <TableRow className="border-line-soft hover:bg-transparent">
            <SortableColumnHead
              baseHref={baseHref}
              column="name"
              defaultOrder={USERS_DEFAULT_SORT_ORDER.name}
              current={current}
              visibleLabel={userColumnLabel}
              accessibleLabel={accessibleSortLabel(
                'name',
                USERS_DEFAULT_SORT_ORDER.name,
                userColumnLabel
              )}
            />
            <TableHead>{t('usersColumnVerification')}</TableHead>
            <TableHead>{t('usersColumnRole')}</TableHead>
            <SortableColumnHead
              baseHref={baseHref}
              column="lastLoginAt"
              defaultOrder={USERS_DEFAULT_SORT_ORDER.lastLoginAt}
              current={current}
              visibleLabel={lastLoginColumnLabel}
              accessibleLabel={accessibleSortLabel(
                'lastLoginAt',
                USERS_DEFAULT_SORT_ORDER.lastLoginAt,
                lastLoginColumnLabel
              )}
              className={MONO}
            />
            <SortableColumnHead
              baseHref={baseHref}
              column="createdAt"
              defaultOrder={USERS_DEFAULT_SORT_ORDER.createdAt}
              current={current}
              visibleLabel={createdColumnLabel}
              accessibleLabel={accessibleSortLabel(
                'createdAt',
                USERS_DEFAULT_SORT_ORDER.createdAt,
                createdColumnLabel
              )}
              className={MONO}
            />
            <SortableColumnHead
              baseHref={baseHref}
              column="updatedAt"
              defaultOrder={USERS_DEFAULT_SORT_ORDER.updatedAt}
              current={current}
              visibleLabel={updatedColumnLabel}
              accessibleLabel={accessibleSortLabel(
                'updatedAt',
                USERS_DEFAULT_SORT_ORDER.updatedAt,
                updatedColumnLabel
              )}
              className={MONO}
            />
            <TableHead>{t('usersColumnActions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              format={format}
              t={t}
              isSelf={user.id === operator?.id}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
