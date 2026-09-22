import type { getFormatter, getTranslations } from 'next-intl/server'
import type { AdminUserResponse } from '@amcore/shared'

import { formatConsoleDate, formatConsoleTime } from '@/shared/lib/format-console-date-time'
import { cn } from '@/shared/lib/utils'
import { TableCell, TableRow } from '@/shared/ui/table'

import { UserRoleAction } from './UserRoleAction'

const MONO = 'font-console-mono'

export interface UserRowProps {
  user: AdminUserResponse
  format: Awaited<ReturnType<typeof getFormatter>>
  t: Awaited<ReturnType<typeof getTranslations>>
  isSelf: boolean
}

export function UserRow({ user, format, t, isSelf }: UserRowProps) {
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
