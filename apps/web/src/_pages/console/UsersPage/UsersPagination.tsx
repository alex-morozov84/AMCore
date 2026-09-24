import { getTranslations } from 'next-intl/server'
import type { AdminUserSortField } from '@amcore/shared'

import {
  buildDiscoveryHref,
  DiscoveryNavigationLink,
  type DiscoverySortOrder,
} from '@/features/console-discovery'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/button'

const MONO = 'font-console-mono'

export interface UsersPaginationProps {
  page: number
  totalPages: number
  baseHref: string
  search?: string
  sortBy: AdminUserSortField
  sortOrder?: DiscoverySortOrder
}

export async function UsersPagination({
  page,
  totalPages,
  baseHref,
  search,
  sortBy,
  sortOrder,
}: UsersPaginationProps) {
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
