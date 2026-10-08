'use client'
import { useTranslations } from 'next-intl'
import type { RoleSummary } from '@amcore/shared'

import { Card, CardContent } from '@/shared/ui/card'
import { DataTableSurface } from '@/shared/ui/data-table-surface'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import { RoleFlags } from './role-flags'
import { RoleNameCell } from './role-name-cell'

/** The editable roles of the organization: essentials in columns, detail on the role page. */
export function RoleTable({
  rows,
  roleHref,
}: {
  rows: RoleSummary[]
  roleHref: (roleId: string) => string
}) {
  const t = useTranslations('organizationRoles')
  const access = (row: RoleSummary) =>
    row.ruleCount > 0 ? t('rules', { count: row.ruleCount }) : t('noRules')
  const holders = (row: RoleSummary) => t('holdersCount', { count: row.holderCount })
  return (
    <>
      <DataTableSurface className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="border-line-soft hover:bg-transparent">
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('access')}</TableHead>
              <TableHead>{t('holders')}</TableHead>
              <TableHead>{t('flags')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="border-line-soft">
                <TableCell className="max-w-sm whitespace-normal">
                  <RoleNameCell role={row} href={roleHref(row.id)} />
                </TableCell>
                <TableCell>{access(row)}</TableCell>
                <TableCell>{holders(row)}</TableCell>
                <TableCell>
                  <RoleFlags role={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableSurface>
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <Card key={row.id}>
            <CardContent className="space-y-3">
              <RoleNameCell role={row} href={roleHref(row.id)} />
              <p className="text-sm text-muted-foreground">
                {access(row)} · {holders(row)}
              </p>
              <RoleFlags role={row} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
