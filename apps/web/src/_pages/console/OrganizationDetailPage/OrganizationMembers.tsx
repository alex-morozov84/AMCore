import { getFormatter, getTranslations } from 'next-intl/server'
import type { AdminOrganizationDetailResponse } from '@amcore/shared'

import { getConsoleUserDetailHref } from '@/shared/lib/console-public-href'
import { formatConsoleDate } from '@/shared/lib/format-console-date-time'
import { DetailRoles } from '@/shared/ui/console-detail/DetailRoles'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

type Member = AdminOrganizationDetailResponse['members']['data'][number]

export async function OrganizationMembers({ rows }: { rows: Member[] }) {
  const [t, format] = await Promise.all([getTranslations('console.detail'), getFormatter()])
  return (
    <>
      <div className="hidden rounded-lg border border-border bg-surface-elevated shadow-md sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('user')}</TableHead>
              <TableHead>{t('roles')}</TableHead>
              <TableHead>{t('joined')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.user.id}>
                <TableCell>
                  <RouteProgressLink
                    prefetch={false}
                    href={getConsoleUserDetailHref(row.user.id)}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {row.user.name ?? row.user.email}
                  </RouteProgressLink>
                  <p className="font-console-mono text-xs text-muted-foreground">
                    {row.user.email}
                  </p>
                </TableCell>
                <TableCell>
                  <DetailRoles roles={row.roles} empty={t('noRoles')} />
                </TableCell>
                <TableCell>
                  <time dateTime={row.joinedAt}>
                    {formatConsoleDate(format, new Date(row.joinedAt))}
                  </time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <li
            key={row.user.id}
            className="space-y-2 rounded-lg border border-border bg-surface-elevated p-4"
          >
            <RouteProgressLink
              prefetch={false}
              href={getConsoleUserDetailHref(row.user.id)}
              className="font-medium underline-offset-2 hover:underline"
            >
              {row.user.name ?? row.user.email}
            </RouteProgressLink>
            <p className="font-console-mono break-all text-xs text-muted-foreground">
              {row.user.email}
            </p>
            <DetailRoles roles={row.roles} empty={t('noRoles')} />
            <p className="text-xs text-muted-foreground">
              {t('joined')}:{' '}
              <time dateTime={row.joinedAt}>
                {formatConsoleDate(format, new Date(row.joinedAt))}
              </time>
            </p>
          </li>
        ))}
      </ul>
    </>
  )
}
