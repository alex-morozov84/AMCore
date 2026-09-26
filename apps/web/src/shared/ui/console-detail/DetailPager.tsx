import { getTranslations } from 'next-intl/server'

import { detailPageHref } from '@/shared/lib/console-detail-url'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/button'

import { DetailRelationNavigationLink } from './DetailRelationSearch'

export async function DetailPager({
  base,
  page,
  totalPages,
  returnTo,
  search,
}: {
  base: string
  page: number
  totalPages: number
  returnTo?: string
  search?: string
}) {
  if (totalPages < 2) return null
  const t = await getTranslations('console')
  const link = (target: number) => detailPageHref(base, target, returnTo, search)
  return (
    <nav
      aria-label={t('paginationStatus', { page, totalPages })}
      className="flex items-center justify-between gap-3 text-sm"
    >
      {page > 1 ? (
        <DetailRelationNavigationLink
          href={link(page - 1)}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          {t('paginationPrevious')}
        </DetailRelationNavigationLink>
      ) : (
        <span />
      )}
      <span className="font-console-mono text-muted-foreground">
        {t('paginationStatus', { page, totalPages })}
      </span>
      {page < totalPages ? (
        <DetailRelationNavigationLink
          href={link(page + 1)}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          {t('paginationNext')}
        </DetailRelationNavigationLink>
      ) : (
        <span />
      )}
    </nav>
  )
}
