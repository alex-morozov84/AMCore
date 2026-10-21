'use client'

import type { ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { ScheduledJob } from '@amcore/shared'

import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'

import { describeSchedule, durationParts } from '../model/schedule-copy'

const time = (value: string): ReactNode => (
  <ConsoleTimestamp value={value} variant="inline" seconds />
)

/** Localized name and one-line purpose; a job registered downstream without copy shows its id. */
export function JobName({ job }: { job: ScheduledJob }) {
  const t = useTranslations('console.scheduledJobs.jobs')
  const nameKey = `${job.id}.name` as Parameters<typeof t.has>[0]
  const purposeKey = `${job.id}.purpose` as Parameters<typeof t.has>[0]
  const known = t.has(nameKey)
  return (
    <div className="space-y-0.5">
      <p className="font-medium">{known ? t(nameKey) : job.id}</p>
      {known && <p className="text-xs text-muted-foreground">{t(purposeKey)}</p>}
    </div>
  )
}

export function JobSchedule({ job }: { job: ScheduledJob }) {
  const t = useTranslations('console.scheduledJobs.schedule')
  const text = describeSchedule(job.schedule)
  const zone =
    job.config.state === 'enabled'
      ? (job.config.scheduleTimeZone ?? null)
      : job.schedule.kind === 'cron'
        ? job.schedule.timeZone
        : null
  return (
    <div className="space-y-0.5">
      <p>
        {text.kind === 'daily' && t('daily', { time: text.time })}
        {text.kind === 'everySeconds' && t('everySeconds', { seconds: text.seconds })}
        {text.kind === 'everyMinute' && t('everyMinute')}
        {text.kind === 'raw' && <span className="font-console-mono">{text.expression}</span>}
      </p>
      {text.kind === 'daily' && zone && <p className="text-xs text-muted-foreground">{zone}</p>}
    </div>
  )
}

export function JobDuration({ ms }: { ms: number | null }) {
  const t = useTranslations('console.scheduledJobs.duration')
  const locale = useLocale()
  if (ms === null) return <span aria-label={t('none')}>—</span>
  const { unit, n } = durationParts(ms)
  return (
    <>{t(unit, { n: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n) })}</>
  )
}

/** The last successful run, with a warning when the schedule has changed since. */
export function JobLastSuccess({ job }: { job: ScheduledJob }) {
  const t = useTranslations('console.scheduledJobs')
  if (!job.lastSuccess) return <span aria-label={t('lastSuccess.none')}>—</span>
  return (
    <div className="space-y-0.5">
      <ConsoleTimestamp value={job.lastSuccess.startedAt} />
      {!job.lastSuccess.underCurrentConfig && (
        <p className="text-xs text-muted-foreground">{t('lastSuccess.earlierSchedule')}</p>
      )}
    </div>
  )
}

function useBucketLabels() {
  const t = useTranslations('console.scheduledJobs.buckets')
  return (codes: string[]) =>
    codes
      .map((code) => {
        const key = code as Parameters<typeof t.has>[0]
        return t.has(key) ? t(key) : code
      })
      .join(', ')
}

/** A recorded code in words; an id a downstream job invented is shown as it is. */
export function useCodeLabel() {
  const t = useTranslations('console.scheduledJobs.codes')
  return (code: string): string => {
    const key = code as Parameters<typeof t.has>[0]
    return t.has(key) ? t(key) : code
  }
}

function ResultNote({ job }: { job: ScheduledJob }) {
  const t = useTranslations('console.scheduledJobs.notes')
  const labels = useBucketLabels()
  const codeLabel = useCodeLabel()
  const { result } = job
  if (result.state === 'running')
    return (
      <p>
        {t('running')} {time(result.startedAt)}.
      </p>
    )
  if (result.state === 'unknown')
    return (
      <p>
        {t('unknownStarted')} {time(result.startedAt)}. {t('unknownRest')}
      </p>
    )
  if (result.state !== 'partial' && result.state !== 'failed') return null
  const codes = result.summary?.codes ?? []
  const text =
    codes.length > 0
      ? t(result.state === 'partial' ? 'partialSteps' : 'failedSteps', { steps: labels(codes) })
      : result.state === 'partial'
        ? t('partialCount', { count: result.summary?.counts.isolatedFailures ?? 1 })
        : t('failedCode', { code: codeLabel(result.code ?? 'unexpected') })
  return <p>{text}</p>
}

/**
 * Explanations under a row: why a state looks the way it does, so nobody has to open the
 * documentation to read it. Only what applies to this job is shown.
 */
export function JobNotes({ job }: { job: ScheduledJob }) {
  const t = useTranslations('console.scheduledJobs.notes')
  const skipReason = useTranslations('console.scheduledJobs.skipReasons')
  const configReason = useTranslations('console.scheduledJobs.disabledReasons')
  const notes: ReactNode[] = []
  if (job.config.state === 'not_reported') notes.push(<p key="config">{t('notReported')}</p>)
  if (job.config.state === 'disabled') {
    const reason = job.config.reason as Parameters<typeof configReason.has>[0]
    notes.push(
      <p key="config">{configReason.has(reason) ? configReason(reason) : t('disabledGeneric')}</p>
    )
  }
  if (job.config.state === 'enabled') {
    notes.push(<ResultNote key="result" job={job} />)
    if (job.freshness.state === 'stale' && job.freshness.dueAt)
      notes.push(
        <p key="due">
          {t('overdue')} {time(job.freshness.dueAt)}.
        </p>
      )
    if (job.skip)
      notes.push(
        <p key="skip">
          {t('skipped', { reason: skipReason(job.skip.reason) })} {time(job.skip.at)}
        </p>
      )
    if (job.droppedEvents > 0)
      notes.push(<p key="dropped">{t('dropped', { count: job.droppedEvents })}</p>)
  }
  const shown = notes.filter(Boolean)
  if (shown.length === 0) return null
  return <div className="space-y-1 text-xs text-muted-foreground">{shown}</div>
}
