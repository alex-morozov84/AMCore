import { useLocale, useTranslations } from 'next-intl'
import type { WorkSummary } from '@amcore/shared'
import { CircleCheck, CircleSlash, Pause, Play, TriangleAlert } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { InfoTooltip } from '@/shared/ui/info-tooltip'

import { workLabel } from './work-label'

const queueOperations = ['pause', 'resume'] as const

/** Catalogue presentation; command capture and submission stay with the feature owner. */
export function WorkCard({
  work,
  selected,
  blocked,
  onInspect,
  onCapture,
}: {
  work: WorkSummary
  selected: boolean
  blocked: boolean
  onInspect(): void
  onCapture(operation: 'pause' | 'resume', trigger: HTMLButtonElement): void
}) {
  const locale = useLocale()
  const t = useTranslations('console.backgroundWork.control')
  const queue = useTranslations('console.backgroundWork')
  const errors = useTranslations('errors')
  const operation = work.paused === undefined ? null : work.paused ? 'resume' : 'pause'
  const noQueuePause = queueOperations.every(
    (operation) =>
      work.capabilities.find((item) => item.operation === operation)?.reason ===
      'ACTION_UNAVAILABLE'
  )
  const reason = work.capabilities.find(
    (item) =>
      queueOperations.some((operation) => operation === item.operation) &&
      item.reason &&
      !['ALREADY_IN_STATE', 'ACTION_UNAVAILABLE'].includes(item.reason)
  )?.reason
  const StatusIcon =
    work.status === 'available'
      ? CircleCheck
      : work.status === 'disabled'
        ? CircleSlash
        : TriangleAlert
  const statusColor =
    work.status === 'available'
      ? 'text-success'
      : work.status === 'disabled'
        ? 'text-muted-foreground'
        : 'text-danger'
  return (
    <Card role="article">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <CardTitle as="h3" className="break-all font-console-mono">
          {workLabel(work.presentation?.name, locale, work.id)}
          {work.presentation && (
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{work.id}</span>
          )}
        </CardTitle>
        <div className="ml-auto space-y-2 text-sm">
          <div className="flex items-center justify-end gap-1.5">
            <StatusIcon className={`size-4 shrink-0 ${statusColor}`} aria-hidden="true" />
            <span>{t(`availability.${work.status}`)}</span>
            <InfoTooltip label={t(`availabilityHelp.${work.status}`)} />
          </div>
          <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
            <span>{t(work.kind === 'durable' ? 'sourceDomain' : 'sourceBroker')}</span>
            <InfoTooltip
              label={t(work.kind === 'durable' ? 'sourceDomainHelp' : 'sourceBrokerHelp')}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {noQueuePause ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>{t('unsupportedQueue')}</span>
            <InfoTooltip label={t('unsupportedQueueHelp')} />
          </div>
        ) : (
          work.paused !== undefined && (
            <div className="flex items-center gap-1.5 text-sm">
              <span>{queue(work.paused ? 'paused' : 'notPaused')}</span>
              <InfoTooltip label={t(work.paused ? 'pausedHelp' : 'notPausedHelp')} />
            </div>
          )
        )}
        {reason && <p className="text-sm text-muted-foreground">{errors(reason)}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={selected ? 'selection-soft' : 'outline'}
            disabled={work.status !== 'available' && !work.providerEvidence}
            aria-expanded={selected}
            onClick={onInspect}
          >
            {t('inspectJobs')}
          </Button>
          {!noQueuePause && operation && (
            <Button
              variant="outline"
              disabled={
                blocked ||
                !work.capabilities.some((item) => item.operation === operation && item.allowed)
              }
              onClick={(event) => onCapture(operation, event.currentTarget)}
            >
              {operation === 'pause' ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {t(`actions.${operation}`)}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
