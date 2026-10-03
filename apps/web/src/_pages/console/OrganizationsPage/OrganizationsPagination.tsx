import { getTranslations } from 'next-intl/server'

import {
  buildDiscoveryHref,
  DiscoveryNavigationLink,
  type DiscoverySortOrder,
} from '@/features/console-discovery'
import { buttonVariants } from '@/shared/ui/button'
import { ListPagination } from '@/shared/ui/list-pagination'

import type { OrganizationsSortableField } from './parse-query'

const MONO = 'font-console-mono'

export interface OrganizationsPaginationProps {
  page: number
  totalPages: number
  baseHref: string
  search?: string
  sortBy: OrganizationsSortableField
  sortOrder?: DiscoverySortOrder
}

export async function OrganizationsPagination({
  page,
  totalPages,
  baseHref,
  search,
  sortBy,
  sortOrder,
}: OrganizationsPaginationProps) {
  if (totalPages === 1) return null
  const t = await getTranslations('console')
  const hrefForPage = (targetPage: number) =>
    buildDiscoveryHref(baseHref, { search, sortBy, sortOrder, page: targetPage })
  return (
    <ListPagination
      className={MONO}
      status={t('paginationStatus', { page, totalPages })}
      previous={
        <PageLink href={page > 1 ? hrefForPage(page - 1) : null} label={t('paginationPrevious')} />
      }
      next={
        <PageLink
          href={page < totalPages ? hrefForPage(page + 1) : null}
          label={t('paginationNext')}
        />
      }
    />
  )
}

function PageLink({ href, label }: { href: string | null; label: string }) {
  return href ? (
    <DiscoveryNavigationLink
      href={href}
      className={buttonVariants({ variant: 'outline', size: 'sm' })}
    >
      {label}
    </DiscoveryNavigationLink>
  ) : (
    <span aria-hidden="true" />
  )
}
