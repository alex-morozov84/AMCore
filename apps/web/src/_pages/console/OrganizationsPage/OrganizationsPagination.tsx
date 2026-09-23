import { getTranslations } from 'next-intl/server'

import { buildDiscoveryHref, type DiscoverySortOrder } from '@/features/console-discovery'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

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
    <nav
      aria-label={t('paginationStatus', { page, totalPages })}
      className={cn(MONO, 'flex items-center justify-between text-sm')}
    >
      <PageLink href={page > 1 ? hrefForPage(page - 1) : null} label={t('paginationPrevious')} />
      <span className="text-foreground-muted">{t('paginationStatus', { page, totalPages })}</span>
      <PageLink
        href={page < totalPages ? hrefForPage(page + 1) : null}
        label={t('paginationNext')}
      />
    </nav>
  )
}

function PageLink({ href, label }: { href: string | null; label: string }) {
  return href ? (
    <RouteProgressLink href={href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      {label}
    </RouteProgressLink>
  ) : (
    <span aria-hidden="true" />
  )
}
