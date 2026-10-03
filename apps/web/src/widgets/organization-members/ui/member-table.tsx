'use client'
import { useFormatter, useTranslations } from 'next-intl'
import type { OrganizationMembersResponse } from '@amcore/shared'

import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { DataTableSurface } from '@/shared/ui/data-table-surface'
import { RoleBadges } from '@/shared/ui/role-badges'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

type Row = OrganizationMembersResponse['data'][number]
export function MemberTable({
  rows,
  actorId,
  disabled,
  onEdit,
}: {
  rows: Row[]
  actorId: string
  disabled: boolean
  onEdit: (userId: string) => void
}) {
  const t = useTranslations('organizationMembers')
  const format = useFormatter()
  const roles = (row: Row) => (
    <>
      <RoleBadges
        roles={row.rolesPreview}
        empty={t('emptyRoles')}
        missingDescription={t('noDescription')}
      />
      {row.assignedRoleCount > row.rolesPreview.length && (
        <span className="text-sm text-muted-foreground">
          +{row.assignedRoleCount - row.rolesPreview.length}
        </span>
      )}
    </>
  )
  const identity = (row: Row) => (
    <div className="space-y-1">
      <p className="break-words font-medium">{row.user.name ?? row.user.email}</p>
      <p className="break-all text-xs text-foreground-muted">{row.user.email}</p>
      {row.user.id === actorId && (
        <span className="text-xs text-muted-foreground">{t('self')}</span>
      )}
    </div>
  )
  const edit = (row: Row) => (
    <Button variant="outline" disabled={disabled} onClick={() => onEdit(row.user.id)}>
      {t('edit')}
    </Button>
  )
  return (
    <>
      <DataTableSurface className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="border-line-soft hover:bg-transparent">
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('roles')}</TableHead>
              <TableHead>{t('joined')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('edit')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.memberId} className="border-line-soft">
                <TableCell>{identity(row)}</TableCell>
                <TableCell>{roles(row)}</TableCell>
                <TableCell>
                  {format.dateTime(new Date(row.joinedAt), { dateStyle: 'medium' })}
                </TableCell>
                <TableCell>{edit(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableSurface>
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <Card key={row.memberId}>
            <CardContent className="space-y-3">
              {identity(row)}
              {roles(row)}
              <p className="text-sm text-muted-foreground">
                {t('joined')}: {format.dateTime(new Date(row.joinedAt), { dateStyle: 'medium' })}
              </p>
              {edit(row)}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
