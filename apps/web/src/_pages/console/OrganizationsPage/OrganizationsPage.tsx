import { getFormatter, getTranslations } from 'next-intl/server'

import { fetchConsoleOrganizations } from '@/shared/api/console/organizations'
import { resolvePrimary } from '@/shared/api/server'
import { getConsoleOrganizationsHref } from '@/shared/lib/console-public-href'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

const MONO = 'font-[family-name:var(--console-font-mono)]'

export interface OrganizationsPageProps {
  page: number
  limit: number
}

/**
 * Read-only Organizations panel. No detail view: the backend has no
 * per-organization endpoint, so the paginated list is the whole contract.
 */
export async function OrganizationsPage({ page, limit }: OrganizationsPageProps) {
  const t = await getTranslations('console')
  const format = await getFormatter()
  const outcome = resolvePrimary(await fetchConsoleOrganizations(page, limit), {
    source: 'console-organizations',
  })

  if (outcome.status === 'unavailable') {
    return <PrimaryUnavailableFallback reason={outcome.reason} />
  }

  const { data, total, page: currentPage, limit: pageSize } = outcome.data
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const baseHref = getConsoleOrganizationsHref()

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">{t('organizations')}</h1>
        <p className={cn(MONO, 'text-sm text-foreground-muted')}>
          {t('organizationsTotal', { total })}
        </p>
      </div>

      {data.length === 0 ? (
        <Empty className="rounded-lg border border-border">
          <EmptyHeader>
            <EmptyTitle>{t('organizationsEmptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('organizationsEmptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-md">
          <Table>
            <TableHeader>
              <TableRow className="border-line-soft hover:bg-transparent">
                <TableHead>{t('organizationsColumnName')}</TableHead>
                <TableHead className={MONO}>{t('organizationsColumnSlug')}</TableHead>
                <TableHead className={MONO}>{t('organizationsColumnCreated')}</TableHead>
                <TableHead className={MONO}>{t('organizationsColumnUpdated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((organization) => (
                <TableRow key={organization.id} className="border-line-soft">
                  <TableCell className="font-medium">{organization.name}</TableCell>
                  <TableCell className={cn(MONO, 'text-foreground-muted')}>
                    {organization.slug}
                  </TableCell>
                  <TableCell className={cn(MONO, 'text-foreground-muted')}>
                    {format.dateTime(new Date(organization.createdAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                  <TableCell className={cn(MONO, 'text-foreground-muted')}>
                    {format.dateTime(new Date(organization.updatedAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <nav
          aria-label={t('paginationStatus', { page: currentPage, totalPages })}
          className={cn(MONO, 'flex items-center justify-between text-sm')}
        >
          {currentPage > 1 ? (
            <RouteProgressLink
              href={`${baseHref}?page=${currentPage - 1}`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              {t('paginationPrevious')}
            </RouteProgressLink>
          ) : (
            <span aria-hidden="true" />
          )}
          <span className="text-foreground-muted">
            {t('paginationStatus', { page: currentPage, totalPages })}
          </span>
          {currentPage < totalPages ? (
            <RouteProgressLink
              href={`${baseHref}?page=${currentPage + 1}`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              {t('paginationNext')}
            </RouteProgressLink>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      )}
    </section>
  )
}
