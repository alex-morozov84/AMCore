import type { ReactNode } from 'react'
import type { AdminOverviewResponse } from '@amcore/shared'

import { ConsoleTimestamp } from '@/shared/ui/console-detail/ConsoleTimestamp'

import type { OverviewFormatter, OverviewTranslations } from './overview-types'

export function OverviewResources({
  overview,
  t,
  format,
}: {
  overview: AdminOverviewResponse
  t: OverviewTranslations
  format: OverviewFormatter
}) {
  const { pool, memory, filesystem } = overview.resources
  const n = (value: number) => format.number(value)
  const bytes = (value: number) =>
    t('overviewMiB', { value: format.number(value / 1024 ** 2, { maximumFractionDigits: 1 }) })
  const percent = (value: number) =>
    format.number(value, { style: 'percent', maximumFractionDigits: 1 })
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ResourceCard
        title={t('overviewPoolTitle')}
        scope={t('overviewPoolScope')}
        sample={pool}
        t={t}
      >
        {pool.status === 'available' && (
          <dl className="space-y-2">
            <Fact label={t('overviewPoolTotal')} value={n(pool.total)} />
            <Fact label={t('overviewPoolIdle')} value={n(pool.idle)} />
            <Fact label={t('overviewPoolWaiting')} value={n(pool.waiting)} />
            <Fact label={t('overviewPoolMax')} value={n(pool.max)} />
            <Fact
              label={t('overviewPoolTrigger')}
              value={t('overviewAbove', { value: n(pool.waitingThreshold) })}
            />
          </dl>
        )}
      </ResourceCard>
      <ResourceCard
        title={t('overviewMemoryTitle')}
        scope={t('overviewMemoryScope')}
        sample={memory}
        t={t}
      >
        {memory.status === 'available' && (
          <dl className="space-y-2">
            <Fact label={t('overviewHeapUsed')} value={bytes(memory.heapUsedBytes)} />
            <Fact
              label={t('overviewHeapLimit')}
              value={t('overviewAbove', { value: bytes(memory.readinessHeapLimitBytes) })}
            />
            <Fact label={t('overviewRss')} value={bytes(memory.rssBytes)} />
          </dl>
        )}
      </ResourceCard>
      <ResourceCard
        title={t('overviewDiskTitle')}
        scope={t('overviewDiskScope')}
        sample={filesystem}
        t={t}
      >
        {filesystem.status === 'available' && (
          <dl className="space-y-2">
            <Fact label={t('overviewDiskTotal')} value={bytes(filesystem.totalBytes)} />
            <Fact label={t('overviewDiskAvailable')} value={bytes(filesystem.availableBytes)} />
            <Fact label={t('overviewDiskPressure')} value={percent(filesystem.pressureRatio)} />
            <Fact
              label={t('overviewDiskTrigger')}
              value={t('overviewAbove', { value: percent(filesystem.pressureThreshold) })}
            />
          </dl>
        )}
      </ResourceCard>
    </div>
  )
}

function ResourceCard({
  title,
  scope,
  sample,
  t,
  children,
}: {
  title: string
  scope: string
  sample: { status: string; sampledAt: string | null }
  t: OverviewTranslations
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border bg-surface-elevated p-6 shadow-md" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{scope}</p>
      <div className="mt-4">
        {sample.status === 'available' ? children : <p>{t('overviewMeasurementUnavailable')}</p>}
      </div>
      {sample.sampledAt && (
        <p className="mt-4 text-xs text-muted-foreground">
          {t('overviewSampledAt')}{' '}
          <ConsoleTimestamp value={sample.sampledAt} variant="inline" seconds />
        </p>
      )}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-console-mono tabular-nums">{value}</dd>
    </div>
  )
}
