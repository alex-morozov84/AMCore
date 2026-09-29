import { getTranslations } from 'next-intl/server'
import type { AdminUserDetailResponse } from '@amcore/shared'

import { getConsoleOrganizationDetailHref } from '@/shared/lib/console-public-href'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { DetailRoles } from '@/shared/ui/console-detail/DetailRoles'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

type Membership = AdminUserDetailResponse['memberships']['data'][number]

export async function UserMemberships({ rows }: { rows: Membership[] }) {
  const t = await getTranslations('console.detail')
  return (
    <>
      <div className="hidden rounded-lg border border-border bg-surface-elevated shadow-md sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('organization')}</TableHead>
              <TableHead>{t('roles')}</TableHead>
              <TableHead>{t('joined')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.organization.id}>
                <TableCell>
                  <RouteProgressLink
                    prefetch={false}
                    href={getConsoleOrganizationDetailHref(row.organization.id)}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {row.organization.name}
                  </RouteProgressLink>
                  <p className="font-console-mono text-xs text-muted-foreground">
                    {row.organization.slug}
                  </p>
                </TableCell>
                <TableCell>
                  <DetailRoles roles={row.roles} empty={t('noRoles')} />
                </TableCell>
                <TableCell>
                  <ConsoleTimestamp value={row.joinedAt} variant="date" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <li
            key={row.organization.id}
            className="space-y-2 rounded-lg border border-border bg-surface-elevated p-4"
          >
            <RouteProgressLink
              prefetch={false}
              href={getConsoleOrganizationDetailHref(row.organization.id)}
              className="font-medium underline-offset-2 hover:underline"
            >
              {row.organization.name}
            </RouteProgressLink>
            <p className="font-console-mono text-xs text-muted-foreground">
              {row.organization.slug}
            </p>
            <DetailRoles roles={row.roles} empty={t('noRoles')} />
            <p className="text-xs text-muted-foreground">
              {t('joined')}: <ConsoleTimestamp value={row.joinedAt} variant="date" />
            </p>
          </li>
        ))}
      </ul>
    </>
  )
}
