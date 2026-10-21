'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { SCHEDULED_HISTORY_PAGE, scheduledRunsResponseSchema } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { consoleApi } from '@/shared/api/console-api'
import { isAccessLoss } from '@/shared/lib/console-poll-policy'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { Disclosure } from '@/shared/ui/disclosure'
import { Skeleton } from '@/shared/ui/skeleton'

import { JobDuration, RunSummary } from './job-details'
import { useScheduledJobsScope } from './scheduled-jobs-context'

/**
 * Only an opened history fetches; the list never carries runs. Unmounting aborts the request and
 * discards the private cache, so history can never outlive the access that allowed it.
 */
export function ScheduledJobHistory({ jobId }: { jobId: string }) {
  const t = useTranslations('console.scheduledJobs.history')
  const [open, setOpen] = useState(false)
  return (
    <Disclosure
      label={t('title')}
      className="mt-2"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      {open && <HistoryContent jobId={jobId} />}
    </Disclosure>
  )
}

function HistoryContent({ jobId }: { jobId: string }) {
  const { instance, onAccessLoss } = useScheduledJobsScope()
  const t = useTranslations('console.scheduledJobs.history')
  const result = useTranslations('console.scheduledJobs.result')
  const query = useQuery({
    queryKey: ['console', 'scheduled-jobs', 'runs', instance, jobId],
    queryFn: async ({ signal }) =>
      scheduledRunsResponseSchema.parse(await consoleApi.getScheduledJobRuns(jobId, signal)),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const runs = query.data?.runs ?? []
  const accessLost = isAccessLoss(query.error)
  // A refused history is the page's problem: the owner hides everything and re-admits once.
  useEffect(() => {
    if (accessLost) onAccessLoss()
  }, [accessLost, onAccessLoss])
  if (accessLost) return null
  // A failed refresh keeps the older runs, and says from when they are.
  const refreshFailed = query.isError && query.data !== undefined
  return (
    <div className="space-y-2" aria-busy={query.isFetching}>
      <ApiErrorAlert error={query.error} />
      {refreshFailed && query.data && (
        <p role="status" className="text-muted-foreground">
          {t('staleLead')}{' '}
          <ConsoleTimestamp value={query.data.checkedAt} variant="inline" seconds />.
        </p>
      )}
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
            <RunSummary code={run.code} summary={run.summary} />
          </li>
        ))}
      </ol>
      {query.data?.truncated && (
        <p className="text-muted-foreground">{t('truncated', { count: SCHEDULED_HISTORY_PAGE })}</p>
      )}
    </div>
  )
}
