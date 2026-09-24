import { getTranslations } from 'next-intl/server'

import {
  buildDiscoveryHref,
  DiscoveryNavigationLink,
  type DiscoverySortOrder,
} from '@/features/console-discovery'
import { buttonVariants } from '@/shared/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'

import type { OrganizationsSortableField } from './parse-query'

export interface OrganizationsOutOfRangeProps {
  totalPages: number
  baseHref: string
  search?: string
  sortBy: OrganizationsSortableField
  sortOrder?: DiscoverySortOrder
}

export async function OrganizationsOutOfRange({
  totalPages,
  baseHref,
  search,
  sortBy,
  sortOrder,
}: OrganizationsOutOfRangeProps) {
  const t = await getTranslations('console')
  // Resets only `page` — an operator who narrowed a search and then landed
  // past the last page (e.g. via a stale bookmark) should not also lose
  // that search on recovery.
  const href = buildDiscoveryHref(baseHref, { search, sortBy, sortOrder, page: 1 })
  return (
    <Empty className="rounded-lg border border-border">
      <EmptyHeader>
        <EmptyTitle>{t('organizationsPageOutOfRangeTitle')}</EmptyTitle>
        <EmptyDescription>
          {t('organizationsPageOutOfRangeDescription', { totalPages })}
        </EmptyDescription>
      </EmptyHeader>
      <DiscoveryNavigationLink href={href} className={buttonVariants({ variant: 'outline' })}>
        {t('organizationsPageOutOfRangeAction')}
      </DiscoveryNavigationLink>
    </Empty>
  )
}
