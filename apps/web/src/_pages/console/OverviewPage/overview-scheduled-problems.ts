import type { ScheduledJob } from '@amcore/shared'

import { getConsoleScheduledJobsHref } from '@/shared/lib/console-public-href'

import { type ProblemContext, problemFact } from './overview-problem-model'

export function scheduledProblem(ctx: ProblemContext, job: ScheduledJob) {
  if (job.config.state === 'disabled') return
  const base = {
    key: `scheduled:${job.id}`,
    source: 'scheduled' as const,
    name: ctx.name('job', job.id, ctx.t('jobName')),
    technicalId: ctx.name('job', job.id, '') ? undefined : job.id,
    href: `${getConsoleScheduledJobsHref()}?${new URLSearchParams({ focus: job.id })}`,
    action: 'openJob' as const,
    guide: 'docs/operations-console/scheduled-jobs.md#what-to-do',
  }
  const add = (
    priority: number | null,
    text: string,
    at?: string | null,
    time: 'started' | 'due' | 'success' = 'started'
  ) => problemFact(ctx, { ...base, priority, metricAt: at }, { text, at, time })
  if (job.config.state === 'not_reported') {
    add(null, ctx.t('jobUnreported'))
    return
  }
  const state = job.result.state
  if (state === 'failed' || state === 'partial' || state === 'unknown')
    add(
      state === 'failed' ? 1 : state === 'partial' ? 2 : 3,
      ctx.t(state === 'failed' ? 'jobFailed' : state === 'partial' ? 'jobPartial' : 'jobUnknown'),
      job.result.startedAt
    )
  if (job.freshness.state === 'stale') add(2, ctx.t('jobStale'), job.freshness.dueAt, 'due')
  if (job.freshness.state === 'unknown') add(null, ctx.t('jobFreshnessUnknown'))
  const entry = ctx.entries.get(base.key)
  if (entry && job.lastSuccess)
    entry.facts.push({ text: '', at: job.lastSuccess.startedAt, time: 'success' })
}
