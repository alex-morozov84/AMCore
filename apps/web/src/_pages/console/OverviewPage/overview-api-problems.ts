import { ADMIN_OVERVIEW_DEPENDENCY_NAMES, type AdminOverviewResponse } from '@amcore/shared'

import { getConsoleOverviewHref } from '@/shared/lib/console-public-href'

import { type ProblemContext, problemFact } from './overview-problem-model'

export function apiProblems(ctx: ProblemContext, data: AdminOverviewResponse) {
  const dependencies = ADMIN_OVERVIEW_DEPENDENCY_NAMES.filter((name) => name !== 'storage').map(
    (name) =>
      data.dependencies.find((item) => item.name === name) ?? { name, status: 'unknown' as const }
  )
  const bad = dependencies.filter((item) => item.status === 'down' || item.status === 'degraded')
  const storageBad =
    data.storageHealthEnabled &&
    data.dependencies.some(
      (item) => item.name === 'storage' && ['down', 'degraded'].includes(item.status)
    )
  const unexplained = data.readiness !== 'ready' && bad.length === 0 && !storageBad
  const base = {
    key: 'api',
    source: 'overview' as const,
    name: ctx.t('api'),
    href: `${getConsoleOverviewHref()}#overview-api-checks`,
    action: 'openApi' as const,
    guide: apiGuide(bad.map((item) => item.name)),
    metricAt: data.checkedAt,
  }
  if (bad.length || unexplained)
    problemFact(
      ctx,
      {
        ...base,
        priority:
          data.readiness === 'not_ready' || bad.some((item) => item.status === 'down') ? 1 : 2,
      },
      {
        text: ctx.t(
          data.readiness === 'not_ready' || bad.some((item) => item.status === 'down')
            ? 'apiFailed'
            : 'apiDegraded'
        ),
        at: data.checkedAt,
        time: 'checked',
      }
    )
  for (const item of dependencies) {
    if (item.status === 'up') continue
    const key =
      item.status === 'down'
        ? 'dependencyDown'
        : item.status === 'degraded'
          ? 'dependencyDegraded'
          : 'dependencyUnknown'
    problemFact(
      ctx,
      { ...base, priority: null },
      {
        text: ctx.t(key, { name: ctx.name('dependency', item.name, item.name) }),
        at: data.checkedAt,
        time: 'checked',
      }
    )
  }
  if (Object.values(data.resources).some((sample) => sample.status === 'unavailable'))
    problemFact(ctx, { ...base, priority: null }, { text: ctx.t('resourcesMissing') })
}

function apiGuide(names: string[]) {
  if (names.length !== 1) return 'docs/operations/observability.md#health-result-semantics'
  const guides: Record<string, string> = {
    database: 'db.md#database-check-failed',
    redis: 'redis.md#reconnecting',
    memory_heap: 'node-runtime.md#heap-usage',
  }
  return guides[names[0]!]
    ? `docs/operations/runbooks/${guides[names[0]!]}`
    : 'docs/operations/observability.md#health-result-semantics'
}
