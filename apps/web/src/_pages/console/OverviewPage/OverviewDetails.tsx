import { getTranslations } from 'next-intl/server'
import type { AdminOverviewDependency, AdminOverviewResponse } from '@amcore/shared'

import { cn } from '@/shared/lib/utils'
import { InfoTooltip } from '@/shared/ui/info-tooltip'

const MONO = 'font-console-mono'

const DEPENDENCY_LABEL_KEY = {
  database: 'overviewDependencyLabelDatabase',
  redis: 'overviewDependencyLabelRedis',
  disk: 'overviewDependencyLabelDisk',
  memory_heap: 'overviewDependencyLabelMemoryHeap',
  storage: 'overviewDependencyLabelStorage',
} as const

function dependencyLabelKey(name: string) {
  return name in DEPENDENCY_LABEL_KEY
    ? DEPENDENCY_LABEL_KEY[name as keyof typeof DEPENDENCY_LABEL_KEY]
    : undefined
}
const DEPENDENCY_STATUS_KEY = {
  up: 'overviewDependencyStatusUp',
  down: 'overviewDependencyStatusDown',
  unknown: 'overviewDependencyStatusUnknown',
} as const
const DEPENDENCY_DOT_STYLE: Record<AdminOverviewDependency['status'], string> = {
  up: 'bg-success',
  down: 'bg-destructive',
  unknown: 'bg-foreground-muted',
}
const DEPENDENCY_TEXT_STYLE: Record<AdminOverviewDependency['status'], string> = {
  up: 'text-success',
  down: 'text-destructive',
  unknown: 'text-foreground-muted',
}
const PROCESS_ROLE_KEY = {
  all: 'overviewProcessRoleAll',
  web: 'overviewProcessRoleWeb',
  worker: 'overviewProcessRoleWorker',
} as const satisfies Record<AdminOverviewResponse['processRole'], string>

interface OverviewDetailsProps {
  overview: AdminOverviewResponse
}

/**
 * The Overview status card body — version, process role, and dependency
 * states. Every technical identifier (a raw dependency key, the
 * `web`/`worker`/`all` enum, the `unknown` version sentinel) is mapped to a
 * human-facing label; the underlying value is never shown as the primary
 * text, since an operator seeing this cold has no reason to know what
 * `memory_heap` or `all` mean.
 */
export async function OverviewDetails({ overview }: OverviewDetailsProps) {
  const t = await getTranslations('console')

  return (
    <div className="rounded-lg border border-border bg-surface-elevated p-6 shadow-md">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt
            className={cn(MONO, 'flex items-center gap-1 text-xs text-foreground-muted uppercase')}
          >
            {t('overviewVersionLabel')}
            <InfoTooltip label={t('overviewVersionHelp')} />
          </dt>
          <dd className={cn(MONO, 'mt-1 text-sm')}>
            {overview.version === 'unknown' ? t('overviewVersionUnknown') : overview.version}
          </dd>
        </div>
        <div>
          <dt
            className={cn(MONO, 'flex items-center gap-1 text-xs text-foreground-muted uppercase')}
          >
            {t('overviewProcessRoleLabel')}
            <InfoTooltip label={t('overviewProcessRoleHelp')} />
          </dt>
          <dd className={cn(MONO, 'mt-1 text-sm')}>{t(PROCESS_ROLE_KEY[overview.processRole])}</dd>
        </div>
      </dl>

      <div className="mt-6">
        <p className={cn(MONO, 'text-xs text-foreground-muted uppercase')}>
          {t('overviewDependenciesLabel')}
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {overview.dependencies.map((dependency) => {
            const labelKey = dependencyLabelKey(dependency.name)
            return (
              <li
                key={dependency.name}
                className="flex items-center justify-between gap-4 border-line-soft border-b py-1 text-sm last:border-0"
              >
                <span>{labelKey ? t(labelKey) : dependency.name}</span>
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
                  {t(DEPENDENCY_STATUS_KEY[dependency.status])}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
