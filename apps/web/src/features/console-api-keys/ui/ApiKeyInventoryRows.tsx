'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { AdminApiKey } from '@amcore/shared'

import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/shared/ui/table'

import { ApiKeyName, ApiKeyOrganization, ApiKeyOwner, ApiKeyTime } from './ApiKeyMetadata'

export function ApiKeyInventoryRows({
  rows,
  headings,
  returnTo,
  selection,
  menu,
}: {
  rows: AdminApiKey[]
  headings: ReactNode
  returnTo: string
  selection: (row: AdminApiKey) => ReactNode
  menu: (row: AdminApiKey) => ReactNode
}) {
  const t = useTranslations('console.apiKeys')
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface-elevated shadow-md md:block">
        <Table>
          <TableHeader>
            <TableRow>{headings}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{selection(row)}</TableCell>
                <TableCell>
                  <ApiKeyName row={row} />
                </TableCell>
                <TableCell>
                  <ApiKeyOwner row={row} returnTo={returnTo} />
                </TableCell>
                <TableCell>
                  <ApiKeyOrganization row={row} returnTo={returnTo} />
                </TableCell>
                <TableCell>
                  {t(row.status)}
                  {row.revocationReason && (
                    <p className="text-xs text-muted-foreground">{t(row.revocationReason)}</p>
                  )}
                </TableCell>
                <TableCell>
                  <ApiKeyTime value={row.expiresAt} expiry />
                </TableCell>
                <TableCell>
                  <ApiKeyTime value={row.lastUsedAt} />
                </TableCell>
                <TableCell>
                  {row.revokedAt ? <ApiKeyTime value={row.revokedAt} /> : t('notApplicable')}
                </TableCell>
                <TableCell>
                  <ApiKeyTime value={row.createdAt} />
                </TableCell>
                <TableCell>{menu(row)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            className="space-y-3 rounded-lg border border-border bg-surface-elevated p-4"
          >
            <div className="flex items-start justify-between gap-3">
              {selection(row)}
              <ApiKeyName row={row} />
              {menu(row)}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{t('owner')}</dt>
                <dd>
                  <ApiKeyOwner row={row} returnTo={returnTo} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('organization')}</dt>
                <dd>
                  <ApiKeyOrganization row={row} returnTo={returnTo} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('status')}</dt>
                <dd>
                  {t(row.status)}
                  {row.revocationReason && (
                    <p className="text-xs text-muted-foreground">{t(row.revocationReason)}</p>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('expiry')}</dt>
                <dd>
                  <ApiKeyTime value={row.expiresAt} expiry />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('usage')}</dt>
                <dd>
                  <ApiKeyTime value={row.lastUsedAt} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('created')}</dt>
                <dd>
                  <ApiKeyTime value={row.createdAt} />
                </dd>
              </div>
              {row.revokedAt && (
                <div>
                  <dt className="text-muted-foreground">{t('revokedTime')}</dt>
                  <dd>
                    <ApiKeyTime value={row.revokedAt} />
                  </dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}
