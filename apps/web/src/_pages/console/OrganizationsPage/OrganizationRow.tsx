import type { getFormatter } from 'next-intl/server'
import type { AdminOrganizationResponse } from '@amcore/shared'

import { getConsoleOrganizationDetailHref } from '@/shared/lib/console-public-href'
import { cn } from '@/shared/lib/utils'
import { ConsoleContextLink } from '@/shared/ui/console-detail/ConsoleContextLink'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { TableCell, TableRow } from '@/shared/ui/table'

const MONO = 'font-console-mono'

export interface OrganizationRowProps {
  organization: AdminOrganizationResponse
  format: Awaited<ReturnType<typeof getFormatter>>
  returnTo?: string
}

export function OrganizationRow({ organization, returnTo }: OrganizationRowProps) {
  return (
    <TableRow className="border-line-soft">
      <TableCell className="font-medium">
        <ConsoleContextLink
          href={getConsoleOrganizationDetailHref(organization.id, returnTo)}
          detailKey={`organization:${organization.id}`}
          className="underline-offset-2 hover:underline focus-visible:underline"
        >
          {organization.name}
        </ConsoleContextLink>
      </TableCell>
      <TableCell className={cn(MONO, 'text-foreground-muted')}>{organization.slug}</TableCell>
      <TableCell>
        <ConsoleTimestamp value={organization.createdAt} />
      </TableCell>
      <TableCell>
        <ConsoleTimestamp value={organization.updatedAt} />
      </TableCell>
    </TableRow>
  )
}
