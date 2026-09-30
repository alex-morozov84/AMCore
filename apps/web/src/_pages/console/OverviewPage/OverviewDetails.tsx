import type { getTranslations } from 'next-intl/server'
import type { AdminOverviewDependency, AdminOverviewResponse } from '@amcore/shared'
import { ADMIN_OVERVIEW_DEPENDENCY_NAMES } from '@amcore/shared'

import { cn } from '@/shared/lib/utils'

import { DEPENDENCY_LABEL_KEY } from './overview-dependency-labels'

const MONO = 'font-console-mono'

const DEPENDENCY_STATUS_KEY = {
  up: 'overviewDependencyStatusUp',
  down: 'overviewDependencyStatusDown',
  degraded: 'overviewDependencyStatusDegraded',
  unknown: 'overviewDependencyStatusUnknown',
} as const
const DEPENDENCY_DOT_STYLE: Record<AdminOverviewDependency['status'], string> = {
  up: 'bg-success',
  down: 'bg-destructive',
  degraded: 'bg-warning',
  unknown: 'bg-foreground-muted',
}
const DEPENDENCY_TEXT_STYLE: Record<AdminOverviewDependency['status'], string> = {
  up: 'text-success',
  down: 'text-destructive',
  degraded: 'text-warning',
  unknown: 'text-foreground-muted',
}
interface OverviewDetailsProps {
  overview: AdminOverviewResponse
  /**
   * Passed down from `OverviewPage`'s own `getTranslations('console')` call
   * rather than fetched again here — keeps this a plain synchronous
   * component (a nested `async` component can't render through plain
   * ReactDOM outside a real RSC pipeline, which made this untestable).
   */
  t: Awaited<ReturnType<typeof getTranslations<'console'>>>
}

/** Allowlisted dependency states, including missing probes and disabled storage. */
export function OverviewDetails({ overview, t }: OverviewDetailsProps) {
  return (
    <div className="rounded-lg border border-border bg-surface-elevated p-6 shadow-md">
      <div>
        <h2 className={cn(MONO, 'text-xs text-foreground-muted uppercase')}>
          {t('overviewDependenciesLabel')}
        </h2>
        <ul className="mt-2 flex flex-col gap-1">
          {ADMIN_OVERVIEW_DEPENDENCY_NAMES.map((name) =>
            name === 'storage' && !overview.storageHealthEnabled
              ? { name, status: 'unknown' as const }
              : (overview.dependencies.find((entry) => entry.name === name) ?? {
                  name,
                  status: 'unknown' as const,
                })
          ).map((dependency) => (
            <li
              key={dependency.name}
              className="flex items-center justify-between gap-4 border-line-soft border-b py-1 text-sm last:border-0"
            >
              <span>{t(DEPENDENCY_LABEL_KEY[dependency.name])}</span>
              <span
                className={cn(
                  MONO,
                  'flex items-center gap-1.5',
                  DEPENDENCY_TEXT_STYLE[dependency.status]
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn('size-2 rounded-full', DEPENDENCY_DOT_STYLE[dependency.status])}
                />
                {dependency.name === 'storage' && !overview.storageHealthEnabled
                  ? t('overviewStorageNotConfigured')
                  : t(DEPENDENCY_STATUS_KEY[dependency.status])}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
