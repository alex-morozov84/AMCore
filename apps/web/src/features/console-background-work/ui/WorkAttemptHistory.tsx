'use client'

import { useTranslations } from 'next-intl'
import { type WorkJob, workJobSchema } from '@amcore/shared'
import { useQuery } from '@tanstack/react-query'

import { consoleApi } from '@/shared/api/console-api'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { Disclosure } from '@/shared/ui/disclosure'
import { Skeleton } from '@/shared/ui/skeleton'

/** Only the opened inspection fetches detail; list rows never carry attempt history. */
export function WorkAttemptHistory({
  workId,
  row,
  open,
  onOpenChange,
}: {
  workId: string
  row: WorkJob
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const t = useTranslations('console.backgroundWork.control')
  return (
    <Disclosure
      label={t('historyTitle')}
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) onOpenChange(event.currentTarget.open)
      }}
    >
      {open && <HistoryContent workId={workId} row={row} />}
    </Disclosure>
  )
}

/** Unmounting the inspection aborts its request and discards its private detail cache. */
function HistoryContent({ workId, row }: { workId: string; row: WorkJob }) {
  const t = useTranslations('console.backgroundWork.control')
  const detail = useQuery({
    queryKey: ['console', 'background-work', 'detail', workId, row.identity],
    queryFn: ({ signal }) =>
      consoleApi.getBackgroundWorkJob(workId, row.identity.id, signal).then((value) => {
        const result = workJobSchema.parse(value)
        if (result.identity.incarnation !== row.identity.incarnation)
          throw new Error('notification_history_incarnation_changed')
        return result
      }),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const history = detail.isError ? undefined : detail.data?.history
  return (
    <div className="space-y-3" aria-busy={detail.isFetching}>
      <ApiErrorAlert error={detail.error} />
      {detail.isPending && (
        <div role="status">
          <span className="sr-only">{t('loadingJobs')}</span>
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {history?.historyTruncated && (
        <p className="text-muted-foreground">{t('historyTruncated')}</p>
      )}
      {history?.historyExpired && <p className="text-muted-foreground">{t('historyExpired')}</p>}
      {!detail.isPending && !detail.isError && !history?.attempts.length && (
        <p>{t('historyEmpty')}</p>
      )}
      <ol className="space-y-3">
        {history?.attempts.map((attempt) => (
          <li key={attempt.number} className="space-y-1 rounded-md border p-3">
            <p className="font-medium">{t('historyNumber', { number: attempt.number })}</p>
            <p>
              {t(`historyOutcomes.${attempt.outcome}`)}
              {t('separator')}
              {t(
                `${workId === 'ai-run-executions' ? 'aiCertainty' : 'certainty'}.${attempt.certainty}`
              )}
            </p>
            <p>
              {t('historyStarted')} {t('separator')}
              <ConsoleTimestamp value={attempt.startedAt} variant="inline" seconds />
            </p>
            {attempt.finishedAt && (
              <p>
                {t('historyFinished')} {t('separator')}
                <ConsoleTimestamp value={attempt.finishedAt} variant="inline" seconds />
              </p>
            )}
            {attempt.actorId && attempt.commandId && (
              <p className="break-all text-xs">
                {t('historyGrant', { actor: attempt.actorId, command: attempt.commandId })}
              </p>
            )}
            {attempt.reason && (
              <Disclosure label={t('historyReason')} className="text-xs">
                <p className="break-all font-console-mono">{attempt.reason}</p>
              </Disclosure>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
