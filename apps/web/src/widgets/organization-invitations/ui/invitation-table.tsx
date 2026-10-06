'use client'

import { useRef } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type { InviteListItem } from '@amcore/shared'

import { Card, CardContent } from '@/shared/ui/card'
import { DataTableSurface } from '@/shared/ui/data-table-surface'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { RoleBadges } from '@/shared/ui/role-badges'
import { RowActionsMenu } from '@/shared/ui/row-actions-menu'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'

type Action = 'repeat' | 'replace' | 'revoke'
export function InvitationTable({
  rows,
  disabled,
  onAction,
}: {
  rows: InviteListItem[]
  disabled: boolean
  onAction(row: InviteListItem, action: Action, trigger: HTMLElement): void
}) {
  const t = useTranslations('organizationInvitations')
  const format = useFormatter()
  const dates = (row: InviteListItem) => (
    <div className="space-y-1 text-sm">
      <p>
        {t('issued')}: {format.dateTime(new Date(row.issuedAt), { dateStyle: 'medium' })}
        {row.issuedAtEstimated && ` (${t('estimated')})`}
      </p>
      <p>
        {t('expires')}:{' '}
        {format.dateTime(new Date(row.expiresAt), { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
    </div>
  )
  const roles = (row: InviteListItem) => (
    <RoleBadges
      roles={row.roles.map((role) => ({
        id: role.requestedRoleId,
        name:
          role.id === null
            ? `${role.nameAtIssue} (${t('deletedRole')})`
            : (role.name ?? role.nameAtIssue),
        description: role.id === null ? t('deletedRole') : role.description,
      }))}
      empty={t('emptyRoles')}
      missingDescription={t('noDescription')}
    />
  )
  const actions = (row: InviteListItem, surface: 'table' | 'card') => (
    <InvitationRowActions surface={surface} row={row} disabled={disabled} onAction={onAction} />
  )
  return (
    <>
      <DataTableSurface className="hidden md:block">
        <Table>
          <TableCaption className="sr-only">{t('title')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('email')}</TableHead>
              <TableHead>{t('roles')}</TableHead>
              <TableHead>{t('status')}</TableHead>
              <TableHead>{t('dates')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="break-all font-medium">{row.email}</TableCell>
                <TableCell>{roles(row)}</TableCell>
                <TableCell>
                  {t(row.status)}
                  {!row.intentValid && (
                    <p className="text-xs text-muted-foreground">{t('intentInvalid')}</p>
                  )}
                </TableCell>
                <TableCell>{dates(row)}</TableCell>
                <TableCell>{actions(row, 'table')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableSurface>
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <Card key={row.id}>
            <CardContent className="space-y-3">
              <p className="break-all font-medium">{row.email}</p>
              <p className="text-sm">{t(row.status)}</p>
              {!row.intentValid && (
                <p className="text-sm text-muted-foreground">{t('intentInvalid')}</p>
              )}
              {roles(row)}
              {dates(row)}
              {actions(row, 'card')}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}

/** The persistent trigger receives focus after a dialog closes; menu items are ephemeral. */
function InvitationRowActions({
  surface,
  row,
  disabled,
  onAction,
}: {
  row: InviteListItem
  surface: 'table' | 'card'
  disabled: boolean
  onAction(row: InviteListItem, action: Action, trigger: HTMLElement): void
}) {
  const t = useTranslations('organizationInvitations')
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <RowActionsMenu
      triggerRef={trigger}
      triggerId={`invitation-actions-${row.id}-${surface}`}
      disabled={disabled}
      label={t('actionFor', { action: t('actions'), email: row.email })}
    >
      {(['repeat', 'replace', 'revoke'] as const).map((action) => (
        <DropdownMenuItem
          key={action}
          variant={action === 'revoke' ? 'destructive' : 'default'}
          aria-label={t('actionFor', { action: t(action), email: row.email })}
          disabled={disabled || (action === 'repeat' && !row.intentValid)}
          onClick={() => {
            if (trigger.current) onAction(row, action, trigger.current)
          }}
        >
          {t(action)}
        </DropdownMenuItem>
      ))}
    </RowActionsMenu>
  )
}
