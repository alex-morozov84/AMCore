import { getFormatter, getTranslations } from 'next-intl/server'
import type { AdminOrganizationResponse } from '@amcore/shared'

import {
  type DiscoveryQueryState,
  type DiscoverySortOrder,
  SortableColumnHead,
  toggleSortOrder,
} from '@/features/console-discovery'
import { Table, TableBody, TableHeader, TableRow } from '@/shared/ui/table'

import { OrganizationRow } from './OrganizationRow'
import type { OrganizationsSortableField } from './parse-query'

const MONO = 'font-console-mono'

export interface OrganizationsTableProps {
  organizations: AdminOrganizationResponse[]
  baseHref: string
  search?: string
  sortBy: OrganizationsSortableField
  sortOrder?: DiscoverySortOrder
}

export async function OrganizationsTable({
  organizations,
  baseHref,
  search,
  sortBy,
  sortOrder,
}: OrganizationsTableProps) {
  const t = await getTranslations('console')
  const format = await getFormatter()
  const current: Pick<DiscoveryQueryState, 'search' | 'sortBy' | 'sortOrder'> = {
    search,
    sortBy,
    sortOrder,
  }

  function accessibleSortLabel(
    column: OrganizationsSortableField,
    defaultOrder: DiscoverySortOrder,
    visibleLabel: string
  ) {
    const nextOrder = toggleSortOrder(column, current, defaultOrder)
    return t('sortColumnAction', {
      column: visibleLabel,
      direction: t(nextOrder === 'asc' ? 'sortAscending' : 'sortDescending'),
    })
  }

  const nameColumnLabel = t('organizationsColumnName')
  const slugColumnLabel = t('organizationsColumnSlug')
  const createdColumnLabel = t('organizationsColumnCreated')
  const updatedColumnLabel = t('organizationsColumnUpdated')

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated shadow-md">
      <Table>
        <TableHeader>
          <TableRow className="border-line-soft hover:bg-transparent">
            <SortableColumnHead
              baseHref={baseHref}
              column="name"
              defaultOrder="asc"
              current={current}
              visibleLabel={nameColumnLabel}
              accessibleLabel={accessibleSortLabel('name', 'asc', nameColumnLabel)}
            />
            <SortableColumnHead
              baseHref={baseHref}
              column="slug"
              defaultOrder="asc"
              current={current}
              visibleLabel={slugColumnLabel}
              accessibleLabel={accessibleSortLabel('slug', 'asc', slugColumnLabel)}
              className={MONO}
            />
            <SortableColumnHead
              baseHref={baseHref}
              column="createdAt"
              defaultOrder="desc"
              current={current}
              visibleLabel={createdColumnLabel}
              accessibleLabel={accessibleSortLabel('createdAt', 'desc', createdColumnLabel)}
              className={MONO}
            />
            <SortableColumnHead
              baseHref={baseHref}
              column="updatedAt"
              defaultOrder="desc"
              current={current}
              visibleLabel={updatedColumnLabel}
              accessibleLabel={accessibleSortLabel('updatedAt', 'desc', updatedColumnLabel)}
              className={MONO}
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.map((organization) => (
            <OrganizationRow key={organization.id} organization={organization} format={format} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
