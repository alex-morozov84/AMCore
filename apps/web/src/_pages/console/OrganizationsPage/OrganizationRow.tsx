import type { getFormatter } from 'next-intl/server'
import type { AdminOrganizationResponse } from '@amcore/shared'

import { formatConsoleDate, formatConsoleTime } from '@/shared/lib/format-console-date-time'
import { cn } from '@/shared/lib/utils'
import { TableCell, TableRow } from '@/shared/ui/table'

const MONO = 'font-console-mono'

export interface OrganizationRowProps {
  organization: AdminOrganizationResponse
  format: Awaited<ReturnType<typeof getFormatter>>
}

export function OrganizationRow({ organization, format }: OrganizationRowProps) {
  return (
    <TableRow className="border-line-soft">
      <TableCell className="font-medium">{organization.name}</TableCell>
      <TableCell className={cn(MONO, 'text-foreground-muted')}>{organization.slug}</TableCell>
      <TableCell>
        <OrganizationTimestamp value={organization.createdAt} format={format} />
      </TableCell>
      <TableCell>
        <OrganizationTimestamp value={organization.updatedAt} format={format} />
      </TableCell>
    </TableRow>
  )
}

function OrganizationTimestamp({
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
