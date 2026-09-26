import type { getFormatter, getTranslations } from 'next-intl/server'
import type { AdminUserResponse } from '@amcore/shared'

import { UserRoleAction } from '@/features/console-user-role'
import { getConsoleUserDetailHref } from '@/shared/lib/console-public-href'
import { formatConsoleDate, formatConsoleTime } from '@/shared/lib/format-console-date-time'
import { cn } from '@/shared/lib/utils'
import { ConsoleContextLink } from '@/shared/ui/console-detail/ConsoleContextLink'
import { TableCell, TableRow } from '@/shared/ui/table'

const MONO = 'font-console-mono'

export interface UserRowProps {
  user: AdminUserResponse
  format: Awaited<ReturnType<typeof getFormatter>>
  t: Awaited<ReturnType<typeof getTranslations>>
  isSelf: boolean
  returnTo?: string
}

export function UserRow({ user, format, t, isSelf, returnTo }: UserRowProps) {
  return (
    <TableRow className="border-line-soft">
      <TableCell>
        <ConsoleContextLink
          href={getConsoleUserDetailHref(user.id, returnTo)}
          detailKey={`user:${user.id}`}
          className="font-medium underline-offset-2 hover:underline focus-visible:underline"
        >
          {user.name ?? user.email}
        </ConsoleContextLink>
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
