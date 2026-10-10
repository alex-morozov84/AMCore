import { useLocale, useTranslations } from 'next-intl'
import type { WorkJob, WorkSummary } from '@amcore/shared'

import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { Disclosure } from '@/shared/ui/disclosure'
import { InfoTooltip } from '@/shared/ui/info-tooltip'

import { workLabel } from './work-label'
import { WorkProjection } from './WorkProjection'

/** Read-only per-job diagnostics; selection and ADMIN capture stay with WorkJobs. */
export function WorkJobDetails({
  row,
  work,
  showState,
}: {
  row: WorkJob
  work: WorkSummary
  showState: boolean
}) {
  const locale = useLocale()
  const t = useTranslations('console.backgroundWork.control')
  const errors = useTranslations('errors')
  const unavailable = row.capabilities.filter(
    (item) =>
      !item.allowed && item.reason && ['retry', 'cancel', 'cleanup'].includes(item.operation)
  )
  function reasonLabel(
    reason: NonNullable<WorkJob['capabilities'][number]['reason']>,
    operation: WorkJob['capabilities'][number]['operation']
  ) {
    if (['EFFECT_UNKNOWN', 'OUTCOME_UNRECORDED'].includes(reason))
      return t(operation === 'retry' ? 'actionReasons.uncertain' : 'actionReasons.unknown')
    if (reason === 'ACTIVE_JOB')
      return t(operation === 'cancel' ? 'actionReasons.started' : 'actionReasons.active')
    if (reason === 'MANUAL_GRANT_SPENT')
      return t(row.manualGrant === 'reserved' ? 'manualRetryReservedHelp' : 'manualRetrySpentHelp')
    if (reason === 'STATE_CHANGED') return t('actionReasons.changed')
    return errors(reason)
  }
  return (
    <>
      {showState && <p className="text-sm">{t(`jobStates.${row.state}`)}</p>}
      <p className="text-sm">
        <ConsoleTimestamp value={row.sampledAt} variant="inline" seconds />
      </p>
      <p className="text-sm text-muted-foreground">
        {t('attempts', {
          started: row.attemptsStarted,
          made: row.attemptsMade ?? t('notDisplayed'),
          grant: t(`grants.${row.manualGrant}`),
        })}
      </p>
      {row.certainty && (
        <div className="flex items-center gap-1.5 text-sm">
          <span>{t(`certainty.${row.certainty}`)}</span>
          <InfoTooltip label={t(`certaintyHelp.${row.certainty}`)} />
        </div>
      )}
      {row.report === 'unrecorded' && (
        <div className="flex items-center gap-1.5 text-sm">
          <span>{t('outcomeUnrecorded')}</span>
          <InfoTooltip label={t('outcomeUnrecordedHelp')} />
        </div>
      )}
      {row.state === 'failed' && (
        <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">{t('failureTitle')}</p>
          <p>
            {row.failure
              ? workLabel(row.failure.title, locale, row.failure.title.en!)
              : t('failureUnavailable')}
          </p>
          {row.failure?.nextStep && (
            <p>
              <span className="font-medium">{t('failureNextStep')} </span>
              {workLabel(row.failure.nextStep, locale, row.failure.nextStep.en!)}
            </p>
          )}
          {row.failure && (
            <Disclosure label={t('technicalDetails')} className="text-xs">
              <p className="font-console-mono text-muted-foreground">{row.failure.code}</p>
            </Disclosure>
          )}
        </div>
      )}
      <WorkProjection work={work} values={row.projection} />
      {!!unavailable.length && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{t('unavailableActions')}</span>
          {unavailable.map((item) => (
            <span key={item.operation} className="inline-flex items-center gap-1">
              {t(`actions.${item.operation}`)}
              <InfoTooltip label={reasonLabel(item.reason!, item.operation)} />
            </span>
          ))}
        </div>
      )}
    </>
  )
}
