'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { type WorkJob, type WorkListQuery, workPageSchema, type WorkSummary } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { ApiRequestError } from '@/shared/api'
import { consoleApi } from '@/shared/api/console-api'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Checkbox } from '@/shared/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'
import { FilterButtons } from '@/shared/ui/filter-buttons'
import { PaginationButtons } from '@/shared/ui/pagination'
import { Skeleton } from '@/shared/ui/skeleton'

import { WorkJobDetails } from './WorkJobDetails'
import { WorkUnknownDisposition } from './WorkUnknownDisposition'

type JobAction = 'retry' | 'cancel' | 'cleanup'
const states = ['failed', 'waiting', 'active', 'delayed', 'prioritized', 'completed'] as const

/** Selection contains immutable observations, never identities taken from refreshed rows. */
export function WorkJobs({
  work,
  blocked,
  onCapture,
}: {
  work: WorkSummary
  blocked: boolean
  onCapture(operation: JobAction, rows: WorkJob[], trigger: HTMLButtonElement): void
}) {
  const t = useTranslations('console.backgroundWork.control')
  const errors = useTranslations('errors')
  const instance = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView?.({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    })
  }, [])
  const [query, setQuery] = useState<WorkListQuery>({
    state: 'failed',
    page: 1,
    limit: 25,
    ...(work.providerEvidence && work.status === 'unavailable' ? { source: 'PG_evidence' } : {}),
  })
  const [selected, setSelected] = useState<WorkJob[]>([])
  const page = useQuery({
    queryKey: ['console', 'background-work', 'jobs', work.id, query, instance],
    gcTime: 0,
    queryFn: ({ signal }) =>
      consoleApi
        .getBackgroundWorkJobs(work.id, query, signal)
        .then((value) => workPageSchema.parse(value)),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const accessLost = page.error instanceof ApiRequestError && [401, 403].includes(page.error.status)
  const rows = accessLost ? [] : (page.data?.rows ?? [])
  const operations = ['retry', 'cancel', 'cleanup'] as const
  const allowed = (operation: JobAction) =>
    selected.every((row) =>
      row.capabilities.some(
        (capability) => capability.operation === operation && capability.allowed
      )
    )
  const noActions = selected.length > 0 && !operations.some(allowed)
  return (
    <Card role="region" aria-label={t('jobsTitle', { work: work.id })}>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            ref={heading}
            tabIndex={-1}
            className="scroll-mt-24 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('jobsTitle', { work: work.id })}
          </h3>
        </div>
        {work.providerEvidence && (
          <FilterButtons
            label={t('evidenceMeaning')}
            value={query.source ?? 'broker'}
            options={(['broker', 'PG_evidence'] as const).map((source) => ({
              value: source,
              label: t(`sources.${source}`),
            }))}
            onChange={(source) => {
              setQuery({ ...query, source, page: 1 })
              setSelected([])
            }}
          />
        )}
        {query.source !== 'PG_evidence' && (
          <FilterButtons
            label={t('jobsTitle', { work: work.id })}
            value={query.state}
            options={states.map((state) => ({ value: state, label: t(`jobStates.${state}`) }))}
            onChange={(state) => {
              setQuery({ ...query, state, page: 1 })
              setSelected([])
            }}
          />
        )}
        {query.source === 'PG_evidence' && (
          <p className="text-sm text-muted-foreground">{t('evidenceMeaning')}</p>
        )}
        <ApiErrorAlert error={page.error} />
        {page.data?.reason && <p role="status">{errors(page.data.reason)}</p>}
        {page.data?.windowTruncated && (
          <p className="text-sm text-muted-foreground">{t('windowTruncated')}</p>
        )}
        {page.isPending && (
          <div role="status" className="space-y-3">
            <span className="sr-only">{t('loadingJobs')}</span>
            <div aria-hidden="true" className="space-y-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="space-y-2 rounded-md border p-3">
                  <Skeleton className="h-5 w-48 max-w-full" />
                  <Skeleton className="h-4 w-64 max-w-full" />
                  <Skeleton className="h-4 w-40 max-w-full" />
                </div>
              ))}
            </div>
          </div>
        )}
        {!page.isPending && !page.isError && !page.data?.reason && !rows.length && (
          <Empty className="rounded-lg border border-border">
            <EmptyHeader>
              <EmptyTitle>{t('noJobs')}</EmptyTitle>
              <EmptyDescription>
                {t(query.source === 'PG_evidence' ? 'noEvidenceDescription' : 'noJobsDescription')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <ul className="space-y-3" aria-busy={page.isFetching}>
          {rows.map((row) => (
            <li key={row.identity.incarnation} className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-2">
                <Checkbox
                  disabled={blocked || accessLost || row.source === 'PG_evidence'}
                  checked={selected.some((item) => item.identity.id === row.identity.id)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked
                        ? [
                            ...current.filter((item) => item.identity.id !== row.identity.id),
                            structuredClone(row),
                          ]
                        : current.filter((item) => item.identity.id !== row.identity.id)
                    )
                  }
                />
                <span className="break-all font-console-mono text-sm">{row.identity.id}</span>
              </label>
              {row.source === 'PG_evidence' && (
                <p className="break-all font-console-mono text-xs">
                  {t('incarnation', { id: row.identity.incarnation })}
                </p>
              )}
              <WorkJobDetails
                row={row}
                work={work}
                showState={query.source === 'PG_evidence' || row.state !== query.state}
              />
              {row.reconciliation?.allowed && (
                <WorkUnknownDisposition
                  subject={{
                    kind: 'evidence',
                    workId: work.id,
                    id: row.identity.id,
                    incarnation: row.identity.incarnation,
                    revision: row.reconciliation.revision,
                  }}
                  refresh={() => void page.refetch()}
                />
              )}
              {row.reconciliation?.reason && (
                <p className="text-sm text-muted-foreground">{errors(row.reconciliation.reason)}</p>
              )}
            </li>
          ))}
        </ul>
        {!!selected.length && (
          <div className="flex flex-wrap gap-2">
            {noActions && !blocked ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('noSelectedActions', { count: selected.length })}
              </p>
            ) : (
              operations.map((operation) => (
                <Button
                  key={operation}
                  variant="outline"
                  disabled={
                    blocked ||
                    page.isError ||
                    !work.revision ||
                    !selected.length ||
                    selected.some(
                      (row) =>
                        !row.capabilities.some(
                          (capability) => capability.operation === operation && capability.allowed
                        )
                    )
                  }
                  onClick={(event) =>
                    onCapture(operation, structuredClone(selected), event.currentTarget)
                  }
                >
                  {t(`actions.${operation}`)}
                  {t('separator')}
                  {selected.length}
                </Button>
              ))
            )}
          </div>
        )}
        <PaginationButtons
          page={query.page}
          hasPreviousPage={query.page > 1}
          hasNextPage={rows.length === query.limit && query.page < Math.ceil(512 / query.limit)}
          isFetching={page.isFetching}
          previousLabel={t('previous')}
          nextLabel={t('next')}
          pageLabel={t('page', { page: query.page })}
          onPageChange={(page) => {
            setQuery({ ...query, page })
            setSelected([])
          }}
        />
      </CardContent>
    </Card>
  )
}
