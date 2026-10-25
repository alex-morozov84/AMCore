import type { AdminQueue, WorkSummary } from '@amcore/shared'

import { getConsoleBackgroundWorkHref } from '@/shared/lib/console-public-href'

import { type ProblemContext, problemFact, workCount, workName } from './overview-problem-model'

const guide = 'docs/operations/runbooks/queues.md'
export function queueProblems(ctx: ProblemContext, queue: AdminQueue) {
  if (queue.status === 'disabled') return
  const base = {
    key: `queue:${queue.name}`,
    source: 'queues' as const,
    name: workName(ctx, queue.presentation?.name, ctx.t('queueName')),
    technicalId: queue.name,
    href: `${getConsoleBackgroundWorkHref()}?${new URLSearchParams({ focus: queue.name })}`,
    action: 'openQueue' as const,
    guide: `${guide}#dead-letter`,
  }
  if (queue.status === 'unavailable') {
    problemFact(ctx, { ...base, priority: null }, { text: ctx.t('queueUnreadable') })
    return
  }
  if (queue.counts.failed > 0)
    problemFact(
      ctx,
      { ...base, priority: queue.kind === 'wake' ? 2 : 1, metricAt: queue.sampledAt },
      {
        text: ctx.t(queue.kind === 'wake' ? 'wakeFailed' : 'queueFailed', {
          count: new Intl.NumberFormat(ctx.locale).format(queue.counts.failed),
        }),
        at: queue.sampledAt,
        time: 'read',
      }
    )
  const pending =
    queue.counts.waiting +
    queue.counts.prioritized +
    queue.counts.delayed +
    queue.counts.waitingChildren
  if (queue.paused && pending > 0)
    problemFact(
      ctx,
      { ...base, priority: 4, guide: `${guide}#paused`, metricAt: queue.sampledAt },
      { text: ctx.t('queuePaused'), at: queue.sampledAt, time: 'read' }
    )
}

export function workProblems(ctx: ProblemContext, work: WorkSummary) {
  if (work.kind !== 'durable' || work.status === 'disabled') return
  const safeFailedList = work.counts?.unresolved.value === 0 && !work.counts.unresolved.truncated
  const query = new URLSearchParams({ work: work.id })
  if (safeFailedList && work.counts && work.counts.failed.value > 0) query.set('state', 'failed')
  const base = {
    key: `work:${work.id}`,
    source: 'works' as const,
    name: workName(ctx, work.presentation?.name, ctx.t('workName')),
    technicalId: work.presentation ? undefined : work.id,
    href: `${getConsoleBackgroundWorkHref()}?${query}`,
    action: query.has('state') ? ('openErrors' as const) : ('openWork' as const),
    guide: 'docs/operations-console/background-work.md#unknown-results-and-recovery',
    metricAt: work.sampledAt,
  }
  if (work.status !== 'available' || !work.counts) {
    problemFact(ctx, { ...base, priority: null }, { text: ctx.t('workUnreadable') })
    return
  }
  const { failed, unresolved, pending } = work.counts
  if (failed.value > 0) {
    const key =
      work.id === 'notification-deliveries'
        ? 'notificationFailed'
        : work.id === 'ai-run-executions'
          ? 'aiFailed'
          : 'workFailed'
    const failureGuide =
      work.id === 'notification-deliveries'
        ? 'docs/operations-console/background-work.md#notification-deliveries'
        : work.id === 'ai-run-executions'
          ? `${guide}#ai-run-recovery`
          : 'docs/operations-console/background-work.md#failure-diagnostics'
    problemFact(
      ctx,
      { ...base, priority: 1, guide: safeFailedList ? failureGuide : base.guide },
      { text: ctx.t(key, { count: workCount(ctx, failed) }), at: work.sampledAt, time: 'read' }
    )
  }
  if (unresolved.value > 0)
    problemFact(
      ctx,
      { ...base, priority: 3 },
      {
        text: ctx.t('unresolved', { count: workCount(ctx, unresolved) }),
        at: work.sampledAt,
        time: 'read',
      }
    )
  if (unresolved.value === 0 && unresolved.truncated)
    problemFact(ctx, { ...base, priority: null }, { text: ctx.t('countsMissing') })
  if (work.paused && pending.value > 0)
    problemFact(
      ctx,
      { ...base, priority: 4, guide: `${guide}#paused` },
      { text: ctx.t('workPaused'), at: work.sampledAt, time: 'read' }
    )
}
