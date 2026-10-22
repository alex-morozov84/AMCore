'use client'

import { useTranslations } from 'next-intl'
import type { IntegrationsResponse } from '@amcore/shared'

import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'
import { InfoTooltip } from '@/shared/ui/info-tooltip'

import { useIntegrations } from '../model/use-integrations'
import { useServerNow } from '../model/use-server-now'

import { IntegrationCards } from './IntegrationCards'
import { IntegrationsControls } from './IntegrationsControls'
import { IntegrationsTable } from './IntegrationsTable'

/**
 * Interactive leaf of the page: the data line, controls and rows. The server renders the first
 * snapshot; this leaf keeps it fresh without replacing the surrounding RSC page. Keyed by the
 * snapshot's `readAt` so a re-admitted page starts from clean client state.
 */
export function IntegrationsLive({
  initial,
  initialUpdatedAt,
}: {
  initial: IntegrationsResponse
  initialUpdatedAt: number
}) {
  const t = useTranslations('console.integrations')
  const live = useIntegrations(initial, initialUpdatedAt)
  const { data } = live
  const now = useServerNow(data?.readAt ?? null)
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DataLine readAt={data?.readAt ?? null} refreshFailed={live.refreshFailed} />
        {data && (
          <IntegrationsControls
            auto={live.auto}
            onAutoChange={live.setAuto}
            onRefresh={() => void live.refresh()}
            isFetching={live.isFetching}
            canRefresh={live.canRefresh}
            online={live.online}
            retryAfterSeconds={live.retryAfterSeconds}
          />
        )}
      </div>
      {data &&
        (data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noIntegrations')}</p>
        ) : (
          <>
            <IntegrationsTable items={data.items} now={now} />
            <IntegrationCards items={data.items} now={now} />
            <p className="text-xs text-muted-foreground">{t('setupNote')}</p>
          </>
        ))}
    </>
  )
}

/** When the rows were read, said honestly: a failed refresh never leaves old rows looking fresh. */
function DataLine({ readAt, refreshFailed }: { readAt: string | null; refreshFailed: boolean }) {
  const t = useTranslations('console.integrations')
  if (!readAt) return <p className="text-sm text-muted-foreground">{t('accessChanged')}</p>
  const time = <ConsoleTimestamp value={readAt} variant="inline" seconds />
  return (
    <p
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
      role={refreshFailed ? 'status' : undefined}
    >
      {refreshFailed ? (
        <>
          {t('staleLead')} {time}. {t('staleTail')}
        </>
      ) : (
        <>
          {t('checkedAt')}: {time}
        </>
      )}
      <InfoTooltip label={t('dataHelp')} />
    </p>
  )
}
