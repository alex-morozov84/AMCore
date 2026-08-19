'use client'

import { useMemo, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type { Session } from '@amcore/shared'
import { createColumnHelper, type SortingState, useTable } from '@tanstack/react-table'
import { MoreHorizontal } from 'lucide-react'

import { useSessions } from '@/entities/user'
import { RevokeSessionMenuItem } from '@/features/sessions-revoke'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import { features } from './data-table-features'

const PAGE_SIZE = 20

function RowActions({ session }: { session: Session }) {
  const t = useTranslations('sessions')

  if (session.current) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <span className="sr-only">{t('actions')}</span>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <RevokeSessionMenuItem sessionId={session.id} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const columnHelper = createColumnHelper<typeof features, Session>()

export function SessionsTable() {
  const t = useTranslations('sessions')
  const tCommon = useTranslations('common')
  const format = useFormatter()
  const [page, setPage] = useState(1)
  const [sorting, setSorting] = useState<SortingState>([])
  const { data, isPending, isError } = useSessions(page, PAGE_SIZE)

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('userAgent', {
          header: t('device'),
          cell: (info) => info.getValue() ?? tCommon('notAvailable'),
        }),
        columnHelper.accessor('ipAddress', {
          header: t('ipAddress'),
          cell: (info) => info.getValue() ?? tCommon('notAvailable'),
        }),
        columnHelper.accessor('createdAt', {
          header: t('createdAt'),
          cell: (info) => format.dateTime(new Date(info.getValue()), 'long'),
        }),
        columnHelper.accessor('current', {
          id: 'currentBadge',
          header: '',
          cell: (info) =>
            info.getValue() ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {t('current')}
              </span>
            ) : null,
        }),
        columnHelper.display({
          id: 'actions',
          cell: ({ row }) => <RowActions session={row.original} />,
        }),
      ]),
    [t, tCommon, format]
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
      <div className="overflow-hidden rounded-md border">
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

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((current) => current - 1)}
          disabled={page <= 1}
        >
          {t('previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((current) => current + 1)}
          disabled={!data || page * PAGE_SIZE >= data.total}
        >
          {t('next')}
        </Button>
      </div>
    </div>
  )
}
