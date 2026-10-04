'use client'

import { useTranslations } from 'next-intl'
import { Pause, Play, RefreshCw } from 'lucide-react'

import { Button } from '@/shared/ui/button'
import { InfoTooltip } from '@/shared/ui/info-tooltip'

/** Refresh and auto-refresh controls; auto-refresh never pauses a queue. */
export function QueueSummaryControls({
  auto,
  onAutoChange,
  onRefresh,
  isFetching,
  canRefresh,
  online,
  retryAfterSeconds,
}: {
  auto: boolean
  onAutoChange: (next: boolean) => void
  onRefresh: () => void
  isFetching: boolean
  canRefresh: boolean
  online: boolean
  retryAfterSeconds: number
}) {
  const t = useTranslations('console.backgroundWork')
  const blocked = !canRefresh
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" aria-pressed={auto} onClick={() => onAutoChange(!auto)}>
          {auto ? (
            <Pause aria-hidden="true" className="size-4" />
          ) : (
            <Play aria-hidden="true" className="size-4" />
          )}
          {t(auto ? 'autoRefreshOn' : 'autoRefreshOff')}
        </Button>
        <InfoTooltip label={t('autoRefreshHelp')} />
        <Button
          variant="outline"
          aria-busy={isFetching}
          disabled={isFetching || blocked}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          {t(isFetching ? 'refreshing' : 'refresh')}
        </Button>
      </div>
      {!online && <p className="text-xs text-muted-foreground">{t('offline')}</p>}
      {online && retryAfterSeconds > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('availableIn', { seconds: retryAfterSeconds })}
        </p>
      )}
    </div>
  )
}
