import { getTranslations } from 'next-intl/server'
import type { AdminOverviewDependency } from '@amcore/shared'

import { fetchConsoleOverview } from '@/shared/api/console/overview'
import { resolvePrimary } from '@/shared/api/server'
import { cn } from '@/shared/lib/utils'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

import { OverviewNotReadyAlert } from './OverviewNotReadyAlert'

const MONO = 'font-[family-name:var(--console-font-mono)]'

const DEPENDENCY_STATUS_STYLE: Record<AdminOverviewDependency['status'], string> = {
  up: 'text-foreground',
  down: 'text-destructive',
  unknown: 'text-foreground-muted',
}
const DEPENDENCY_STATUS_KEY = {
  up: 'overviewDependencyStatusUp',
  down: 'overviewDependencyStatusDown',
  unknown: 'overviewDependencyStatusUnknown',
} as const

/**
 * Console Overview: this API instance's readiness, dependency states,
 * version and process role only — no Queues/Recent Activity content (a
 * later, separate backlog item regardless of what the pinned design
 * reference shows on one screen).
 */
export async function OverviewPage() {
  const t = await getTranslations('console')
  const outcome = resolvePrimary(await fetchConsoleOverview(), { source: 'console-overview' })

  if (outcome.status === 'unavailable') {
    return <PrimaryUnavailableFallback reason={outcome.reason} />
  }

  const overview = outcome.data

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className={cn(MONO, 'text-xs tracking-[0.2em] text-foreground-muted uppercase')}>
          {t('overviewEyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t('title')}</h1>
      </div>

      {overview.readiness === 'not_ready' && (
        <OverviewNotReadyAlert dependencies={overview.dependencies} />
      )}

      <div className="rounded-lg border border-border bg-surface-elevated p-6 shadow-md">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className={cn(MONO, 'text-xs text-foreground-muted uppercase')}>
              {t('overviewVersionLabel')}
            </dt>
            <dd className={cn(MONO, 'mt-1 text-sm')}>{overview.version}</dd>
          </div>
          <div>
            <dt className={cn(MONO, 'text-xs text-foreground-muted uppercase')}>
              {t('overviewProcessRoleLabel')}
            </dt>
            <dd className={cn(MONO, 'mt-1 text-sm')}>{overview.processRole}</dd>
          </div>
        </dl>

        <div className="mt-6">
          <p className={cn(MONO, 'text-xs text-foreground-muted uppercase')}>
            {t('overviewDependenciesLabel')}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {overview.dependencies.map((dependency) => (
              <li
                key={dependency.name}
                className="flex items-center justify-between gap-4 border-line-soft border-b py-1 text-sm last:border-0"
              >
                <span>{dependency.name}</span>
                <span className={cn(MONO, DEPENDENCY_STATUS_STYLE[dependency.status])}>
                  {t(DEPENDENCY_STATUS_KEY[dependency.status])}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
