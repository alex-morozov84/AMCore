'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { SCHEDULED_HISTORY_PAGE, scheduledRunsResponseSchema } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { consoleApi } from '@/shared/api/console-api'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { Disclosure } from '@/shared/ui/disclosure'
import { Skeleton } from '@/shared/ui/skeleton'

import { JobDuration, useCodeLabel } from './job-details'

/**
 * Only an opened history fetches; the list never carries runs. Unmounting aborts the request and
 * discards the private cache, so history can never outlive the access that allowed it.
 */
export function ScheduledJobHistory({ jobId, instance }: { jobId: string; instance: string }) {
  const t = useTranslations('console.scheduledJobs.history')
  const [open, setOpen] = useState(false)
  return (
    <Disclosure
      label={t('title')}
      className="mt-2"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {open && <HistoryContent jobId={jobId} instance={instance} />}
    </Disclosure>
  )
}

function HistoryContent({ jobId, instance }: { jobId: string; instance: string }) {
  const t = useTranslations('console.scheduledJobs.history')
  const result = useTranslations('console.scheduledJobs.result')
  const codeLabel = useCodeLabel()
  const query = useQuery({
    queryKey: ['console', 'scheduled-jobs', 'runs', instance, jobId],
    queryFn: async ({ signal }) =>
      scheduledRunsResponseSchema.parse(await consoleApi.getScheduledJobRuns(jobId, signal)),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const runs = query.data?.runs ?? []
  return (
    <div className="space-y-2" aria-busy={query.isFetching}>
      <ApiErrorAlert error={query.error} />
      {query.isPending && (
        <div role="status">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {!query.isPending && !query.isError && runs.length === 0 && <p>{t('empty')}</p>}
      <ol className="space-y-2">
        {runs.map((run) => (
          <li key={run.runId} className="space-y-0.5 rounded-md border p-3">
            <p className="font-medium">{result(run.state)}</p>
            <p>
              <ConsoleTimestamp value={run.startedAt} variant="inline" seconds />
              {run.finishedAt && (
                <>
                  {` ${t('to')} `}
                  <ConsoleTimestamp value={run.finishedAt} variant="inline" seconds />
                </>
              )}
              {run.durationMs !== null && (
                <>
                  {` ${t('dot')} `}
                  <JobDuration ms={run.durationMs} />
                </>
              )}
            </p>
            {run.state === 'unknown' && <p className="text-muted-foreground">{t('unknownRun')}</p>}
            {run.code && <p className="text-muted-foreground">{codeLabel(run.code)}</p>}
          </li>
        ))}
      </ol>
      {query.data?.truncated && (
        <p className="text-muted-foreground">{t('truncated', { count: SCHEDULED_HISTORY_PAGE })}</p>
      )}
    </div>
  )
}
