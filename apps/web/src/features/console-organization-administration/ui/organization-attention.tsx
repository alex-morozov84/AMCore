'use client'

import { useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type { ProductAccessBootstrap } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { administrationClient } from '@/shared/api/console/administration-client'
import { getConsoleOrganizationDetailHref } from '@/shared/lib/console-public-href'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button, buttonVariants } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Empty, EmptyTitle } from '@/shared/ui/empty'
import { PaginationButtons } from '@/shared/ui/pagination'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

import { AdministrationSession } from './administration-session'

function BoundAttention({ admission }: { admission: ProductAccessBootstrap }) {
  const t = useTranslations('console.organizationAdministration')
  const format = useFormatter()
  const [page, setPage] = useState(1)
  const query = useQuery<Awaited<ReturnType<typeof administrationClient.attention>>>({
    queryKey: ['organization-attention', admission.binding, page],
    retry: false,
    refetchInterval: (current) => (current.state.error ? false : 30_000),
    refetchIntervalInBackground: false,
    gcTime: 0,
    queryFn: ({ signal }) => administrationClient.attention(admission.binding, page, signal),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('attentionTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4" aria-busy={query.isFetching}>
        <p className="max-w-2xl text-muted-foreground">{t('attentionHelp')}</p>
        <p className="text-sm text-muted-foreground">{t('attentionAutoRefresh')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="text-sm text-muted-foreground">
            {query.isFetching
              ? t('attentionRefreshing')
              : query.dataUpdatedAt > 0 &&
                t('attentionCheckedAt', {
                  time: format.dateTime(query.dataUpdatedAt, {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  }),
                })}
          </p>
          <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {t('attentionRefresh')}
          </Button>
        </div>
        <ApiErrorAlert error={query.error} />
        {query.isPending ? (
          <p role="status">{t('loading')}</p>
        ) : query.data && !query.isError ? (
          <>
            {!query.data.data.length && (
              <Empty>
                <EmptyTitle>
                  {t(
                    query.data.total > 0
                      ? 'outOfRange'
                      : query.data.organizationTotal
                        ? 'attentionEmpty'
                        : 'noOrganizations'
                  )}
                </EmptyTitle>
              </Empty>
            )}
            {!query.data.data.length && page > 1 && (
              <Button variant="outline" onClick={() => setPage(1)}>
                {t('firstPage')}
              </Button>
            )}
            <ul className="space-y-3">
              {query.data.data.map((row) => (
                <li key={row.organizationId} className="space-y-3 rounded-lg border p-4">
                  <h3 className="break-words font-semibold">{row.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('adminCount', { count: row.adminCount })} ·{' '}
                    {t('pendingCount', { count: row.pendingAdminInvitationCount })}
                  </p>
                  <ul className="list-inside list-disc text-sm">
                    {row.reasons.map((reason) => (
                      <li key={reason}>{t(`reasons.${reason}`)}</li>
                    ))}
                  </ul>
                  <RouteProgressLink
                    href={getConsoleOrganizationDetailHref(row.organizationId)}
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    {t('open')}
                  </RouteProgressLink>
                </li>
              ))}
            </ul>
            <PaginationButtons
              page={page}
              onPageChange={setPage}
              total={query.data.total}
              pageSize={query.data.limit}
              previousLabel={t('previous')}
              nextLabel={t('next')}
              isFetching={query.isFetching}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
export function OrganizationAttention() {
  return (
    <AdministrationSession>
      {(admission) => <BoundAttention key={admission.binding} admission={admission} />}
    </AdministrationSession>
  )
}
