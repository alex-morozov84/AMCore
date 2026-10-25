import {
  getConsoleBackgroundWorkHref,
  getConsoleIntegrationsHref,
  getConsoleOverviewHref,
  getConsoleScheduledJobsHref,
} from '@/shared/lib/console-public-href'

import { apiProblems } from './overview-api-problems'
import { fileProblems } from './overview-file-problems'
import { integrationProblem } from './overview-integration-problems'
import {
  type OverviewSources,
  type ProblemContext,
  type ProblemCopy,
  problemFact,
  type ProblemSource,
} from './overview-problem-model'
import { scheduledProblem } from './overview-scheduled-problems'
import { queueProblems, workProblems } from './overview-work-problems'

const SOURCE_LINKS = {
  overview: getConsoleOverviewHref,
  queues: getConsoleBackgroundWorkHref,
  works: getConsoleBackgroundWorkHref,
  scheduled: getConsoleScheduledJobsHref,
  integrations: getConsoleIntegrationsHref,
}
export function overviewProblems(
  sources: OverviewSources,
  options: Omit<ProblemContext, 'entries' | 'limitations'>
) {
  const ctx: ProblemContext = { ...options, entries: new Map(), limitations: new Set() }
  for (const source of Object.keys(SOURCE_LINKS) as ProblemSource[]) {
    if (sources[source] !== null) continue
    problemFact(
      ctx,
      {
        key: `source:${source}`,
        source,
        name: ctx.t(source),
        priority: null,
        href: SOURCE_LINKS[source](),
        action: 'openSection',
        guide: 'docs/operations-console/overview.md',
      },
      { text: ctx.t('sourceUnavailable') }
    )
  }
  if (sources.overview) apiProblems(ctx, sources.overview)
  fileProblems(
    ctx,
    sources.overview,
    sources.integrations?.items.find((item) => item.id === 'storage')
  )
  for (const queue of sources.queues?.queues.slice(0, 64) ?? []) queueProblems(ctx, queue)
  if ((sources.queues?.queues.length ?? 0) > 64)
    problemFact(
      ctx,
      {
        key: 'queues:overflow',
        source: 'queues',
        name: ctx.t('queues'),
        priority: null,
        href: getConsoleBackgroundWorkHref(),
        action: 'openSection',
        guide: 'docs/operations-console/background-work.md',
      },
      { text: ctx.t('overflow') }
    )
  for (const work of sources.works?.slice(0, 64) ?? []) workProblems(ctx, work)
  for (const job of sources.scheduled?.jobs.slice(0, 64) ?? []) scheduledProblem(ctx, job)
  for (const item of sources.integrations?.items.slice(0, 32) ?? []) integrationProblem(ctx, item)
  queueQualification(ctx, sources)
  const records = [...ctx.entries.values()]
  return {
    attention: records
      .filter((entry) => entry.priority !== null)
      .sort((a, b) => a.priority! - b.priority! || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    gaps: records.filter((entry) => entry.priority === null),
    limitations: ctx.limitations.size > 0,
    allUnavailable: Object.values(sources).every((value) => value === null),
  }
}

function queueQualification(ctx: ProblemContext, sources: OverviewSources) {
  const item = sources.integrations?.items.find((entry) => entry.id === 'queue')
  if (!item || item.configuration === 'disabled') return
  const disagreement =
    sources.queues?.queues.every((queue) => queue.status !== 'unavailable') &&
    item.evidence.result === 'failed'
  if (!sources.queues || disagreement)
    problemFact(
      ctx,
      {
        key: 'queue:aggregate',
        source: 'queues',
        name: ctx.t('queues'),
        priority: null,
        href: `${getConsoleIntegrationsHref()}?focus=queue`,
        action: 'openIntegration',
        guide: 'docs/operations-console/background-work.md#reading-the-screen',
      },
      {
        text: ctx.t(
          disagreement
            ? 'queueDifferent'
            : item.source === 'unavailable'
              ? 'queueUnreadable'
              : 'queueFallback'
        ),
        at: item.evidence.checkedAt,
        time: 'checked',
      }
    )
}
export type OverviewProblems = ReturnType<typeof overviewProblems>
export type { ProblemCopy }
