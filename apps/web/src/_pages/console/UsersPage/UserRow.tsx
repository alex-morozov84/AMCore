import type { getFormatter, getTranslations } from 'next-intl/server'
import type { AdminUserResponse } from '@amcore/shared'

import { UserRoleAction } from '@/features/console-user-role'
import { getConsoleUserDetailHref } from '@/shared/lib/console-public-href'
import { cn } from '@/shared/lib/utils'
import { ConsoleContextLink } from '@/shared/ui/console-detail/ConsoleContextLink'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { TableCell, TableRow } from '@/shared/ui/table'

const MONO = 'font-console-mono'

export interface UserRowProps {
  user: AdminUserResponse
  format: Awaited<ReturnType<typeof getFormatter>>
  t: Awaited<ReturnType<typeof getTranslations>>
  isSelf: boolean
  returnTo?: string
}

export function UserRow({ user, t, isSelf, returnTo }: UserRowProps) {
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
        {user.lastLoginAt ? <ConsoleTimestamp value={user.lastLoginAt} /> : t('usersNeverSignedIn')}
      </TableCell>
      <TableCell>
        <ConsoleTimestamp value={user.createdAt} />
      </TableCell>
      <TableCell>
        <ConsoleTimestamp value={user.updatedAt} />
      </TableCell>
      <TableCell>
        <UserRoleAction user={{ id: user.id, systemRole: user.systemRole }} isSelf={isSelf} />
      </TableCell>
    </TableRow>
  )
}
