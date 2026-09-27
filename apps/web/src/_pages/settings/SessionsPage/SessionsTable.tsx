'use client'

import { useMemo, useState } from 'react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import type { Session } from '@amcore/shared'
import { createColumnHelper, type SortingState, useTable } from '@tanstack/react-table'

import { useSessions } from '@/entities/user'
import { RevokeSessionMenuItem } from '@/features/sessions-revoke'
import { formatSessionLocation, parseSessionDevice } from '@/shared/lib/format-session'
import { useClampPage } from '@/shared/lib/use-clamp-page'
import { PaginationButtons } from '@/shared/ui/pagination'
import { RowActionsMenu } from '@/shared/ui/row-actions-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import { features } from './data-table-features'

const PAGE_SIZE = 20

function RowActions({ session }: { session: Session }) {
  const t = useTranslations('sessions')

  if (session.current) return null

  return (
    <RowActionsMenu label={t('actions')}>
      <RevokeSessionMenuItem sessionId={session.id} />
    </RowActionsMenu>
  )
}

const columnHelper = createColumnHelper<typeof features, Session>()

export function SessionsTable() {
  const t = useTranslations('sessions')
  const tCommon = useTranslations('common')
  const format = useFormatter()
  const locale = useLocale()
  const [page, setPage] = useState(1)
  const [sorting, setSorting] = useState<SortingState>([])
  const { data, isPending, isFetching, isError } = useSessions(page, PAGE_SIZE)
  useClampPage(page, setPage, data?.total, PAGE_SIZE)

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('userAgent', {
          header: t('device'),
          // Parsed "Browser on OS" — never the raw userAgent as the primary
          // label — reusing the same universal formatter the Console admin
          // session panel uses.
          cell: (info) => {
            const { browser, os } = parseSessionDevice(info.getValue())
            return browser && os
              ? t('deviceLabel', { browser, os })
              : (browser ?? os ?? t('deviceUnknown'))
          },
        }),
        columnHelper.accessor('ipAddress', {
          header: t('ipAddress'),
          cell: (info) => {
            const ip = info.getValue()
            const location = formatSessionLocation(info.row.original.location, locale)
            return (
              <div className="space-y-0.5">
                <p>{ip ?? tCommon('notAvailable')}</p>
                <p className="text-xs text-muted-foreground">
                  {location ?? t('locationUnavailable')}
                </p>
              </div>
            )
          },
        }),
        columnHelper.accessor('createdAt', {
          header: t('createdAt'),
          cell: (info) => format.dateTime(new Date(info.getValue()), 'long'),
        }),
        columnHelper.accessor('current', {
          id: 'currentBadge',
          header: () => <span className="sr-only">{t('current')}</span>,
          cell: (info) =>
            info.getValue() ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {t('current')}
              </span>
            ) : null,
        }),
        columnHelper.display({
          id: 'actions',
          header: () => <span className="sr-only">{t('actions')}</span>,
          cell: ({ row }) => <RowActions session={row.original} />,
        }),
      ]),
    [t, tCommon, format, locale]
  )

  const table = useTable({
    features,
    data: data?.data ?? [],
    columns,
    onSortingChange: setSorting,
    state: { sorting },
  })

  if (isError) {
    return <p className="text-sm text-destructive">{t('loadError')}</p>
  }

  return (
    <div className="space-y-4">
      <div aria-busy={isFetching} className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {tCommon('loading')}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {t('noSessions')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data?.data.some((session) => session.location !== null) && (
        <p className="text-xs text-muted-foreground">
          {t.rich('locationAttribution', {
            link: (chunks) => (
              <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="underline">
                {chunks}
              </a>
            ),
          })}
        </p>
      )}

      <PaginationButtons
        page={page}
        pageSize={PAGE_SIZE}
        total={data?.total ?? 0}
        onPageChange={setPage}
        previousLabel={t('previous')}
        nextLabel={t('next')}
        isFetching={isFetching}
      />
    </div>
  )
}
