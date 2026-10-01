import type { ReactNode } from 'react'
import type { AdminOverviewResponse } from '@amcore/shared'

import { InfoTooltip } from '@/shared/ui/info-tooltip'

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
  const bytes = (value: number) => {
    const unit = value >= 1e12 ? 'TB' : value >= 1e9 ? 'GB' : 'MB'
    const scale = unit === 'TB' ? 1e12 : unit === 'GB' ? 1e9 : 1e6
    return t('overviewBytes', {
      value: format.number(value / scale, { maximumFractionDigits: 1 }),
      unit: t(
        unit === 'TB' ? 'overviewUnitTB' : unit === 'GB' ? 'overviewUnitGB' : 'overviewUnitMB'
      ),
    })
  }
  const percent = (value: number) =>
    format.number(value, { style: 'percent', maximumFractionDigits: 1 })
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ResourceCard
        title={t('overviewPoolTitle')}
        scope={t('overviewPoolScope')}
        help={t('overviewPoolHelp')}
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
        help={t('overviewMemoryHelp')}
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
          </dl>
        )}
      </ResourceCard>
      <ResourceCard
        title={t('overviewDiskTitle')}
        scope={t('overviewDiskScope')}
        help={t('overviewDiskHelp')}
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
  help,
  sample,
  t,
  children,
}: {
  title: string
  scope: string
  help: string
  sample: { status: string; sampledAt: string | null }
  t: OverviewTranslations
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border bg-surface-elevated p-6 shadow-md" aria-label={title}>
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <InfoTooltip label={help} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{scope}</p>
      <div className="mt-4">
        {sample.status === 'available' ? children : <p>{t('overviewMeasurementUnavailable')}</p>}
      </div>
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
