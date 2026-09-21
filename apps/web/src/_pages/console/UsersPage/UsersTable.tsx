import { getFormatter, getTranslations } from 'next-intl/server'
import type { AdminUserResponse } from '@amcore/shared'

import { formatConsoleDate, formatConsoleTime } from '@/shared/lib/format-console-date-time'
import { cn } from '@/shared/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

const MONO = 'font-console-mono'
const COLUMNS = [
  'usersColumnUser',
  'usersColumnVerification',
  'usersColumnRole',
  'usersColumnLastLogin',
  'usersColumnCreated',
  'usersColumnUpdated',
] as const

export async function UsersTable({ users }: { users: AdminUserResponse[] }) {
  const t = await getTranslations('console')
  const format = await getFormatter()
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated shadow-md">
      <Table>
        <TableHeader>
          <TableRow className="border-line-soft hover:bg-transparent">
            {COLUMNS.map((column, index) => (
              <TableHead key={column} className={index > 2 ? MONO : undefined}>
                {t(column)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <UserRow key={user.id} user={user} format={format} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

async function UserRow({
  user,
  format,
}: {
  user: AdminUserResponse
  format: Awaited<ReturnType<typeof getFormatter>>
}) {
  const t = await getTranslations('console')
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
