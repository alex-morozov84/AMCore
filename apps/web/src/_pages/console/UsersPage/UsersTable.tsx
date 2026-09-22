import { getFormatter, getTranslations } from 'next-intl/server'
import type { AdminUserResponse, AdminUserSortField } from '@amcore/shared'

import {
  type DiscoveryQueryState,
  type DiscoverySortOrder,
  SortableColumnHead,
  toggleSortOrder,
} from '@/features/console-discovery'
import { getConsoleAwareUser } from '@/shared/api/console/access-token'
import { formatConsoleDate, formatConsoleTime } from '@/shared/lib/format-console-date-time'
import { cn } from '@/shared/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import { UserRoleAction } from './UserRoleAction'

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
    column: AdminUserSortField,
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
              defaultOrder="asc"
              current={current}
              visibleLabel={userColumnLabel}
              accessibleLabel={accessibleSortLabel('name', 'asc', userColumnLabel)}
            />
            <TableHead>{t('usersColumnVerification')}</TableHead>
            <TableHead>{t('usersColumnRole')}</TableHead>
            <SortableColumnHead
              baseHref={baseHref}
              column="lastLoginAt"
              defaultOrder="desc"
              current={current}
              visibleLabel={lastLoginColumnLabel}
              accessibleLabel={accessibleSortLabel('lastLoginAt', 'desc', lastLoginColumnLabel)}
              className={MONO}
            />
            <SortableColumnHead
              baseHref={baseHref}
              column="createdAt"
              defaultOrder="desc"
              current={current}
              visibleLabel={createdColumnLabel}
              accessibleLabel={accessibleSortLabel('createdAt', 'desc', createdColumnLabel)}
              className={MONO}
            />
            <SortableColumnHead
              baseHref={baseHref}
              column="updatedAt"
              defaultOrder="desc"
              current={current}
              visibleLabel={updatedColumnLabel}
              accessibleLabel={accessibleSortLabel('updatedAt', 'desc', updatedColumnLabel)}
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

function UserRow({
  user,
  format,
  t,
  isSelf,
}: {
  user: AdminUserResponse
  format: Awaited<ReturnType<typeof getFormatter>>
  t: Awaited<ReturnType<typeof getTranslations>>
  isSelf: boolean
}) {
  return (
    <TableRow className="border-line-soft">
      <TableCell>
        <p className="font-medium">{user.name ?? user.email}</p>
        {user.name && <p className={cn(MONO, 'text-xs text-foreground-muted')}>{user.email}</p>}
      </TableCell>
      <TableCell>{t(user.emailVerified ? 'usersEmailVerified' : 'usersEmailUnverified')}</TableCell>
      <TableCell>
        {t(user.systemRole === 'SUPER_ADMIN' ? 'superAdminRole' : 'usersRoleUser')}
      </TableCell>
      <TableCell>
        {user.lastLoginAt ? (
          <UserTimestamp value={user.lastLoginAt} format={format} />
        ) : (
          t('usersNeverSignedIn')
        )}
      </TableCell>
      <TableCell>
        <UserTimestamp value={user.createdAt} format={format} />
      </TableCell>
      <TableCell>
        <UserTimestamp value={user.updatedAt} format={format} />
      </TableCell>
      <TableCell>
        <UserRoleAction user={{ id: user.id, systemRole: user.systemRole }} isSelf={isSelf} />
      </TableCell>
    </TableRow>
  )
}

function UserTimestamp({
  value,
  format,
}: {
  value: string
  format: Awaited<ReturnType<typeof getFormatter>>
}) {
  const timestamp = new Date(value)
  return (
    <time dateTime={value} className="flex flex-col leading-tight tabular-nums">
      <span>{formatConsoleDate(format, timestamp)}</span>
      <span className="mt-1 text-xs text-foreground-muted">
        {formatConsoleTime(format, timestamp)}
      </span>
    </time>
  )
}
