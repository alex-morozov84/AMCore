import { getTranslations } from 'next-intl/server'

import { getConsoleUsersHref } from '@/shared/lib/console-public-href'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/button'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

const MONO = 'font-console-mono'

export async function UsersPagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages === 1) return null
  const t = await getTranslations('console')
  const href = getConsoleUsersHref()
  return (
    <nav
      aria-label={t('paginationStatus', { page, totalPages })}
      className={cn(MONO, 'flex items-center justify-between text-sm')}
    >
      <PageLink
        href={page > 1 ? `${href}?page=${page - 1}` : null}
        label={t('paginationPrevious')}
      />
      <span className="text-foreground-muted">{t('paginationStatus', { page, totalPages })}</span>
      <PageLink
        href={page < totalPages ? `${href}?page=${page + 1}` : null}
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
