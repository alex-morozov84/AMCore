import type { getTranslations } from 'next-intl/server'
import type {
  AdminOverviewResponse,
  AdminQueuesResponse,
  IntegrationsResponse,
  ScheduledJobsResponse,
  WorkSummary,
} from '@amcore/shared'

export type ProblemSource = 'overview' | 'queues' | 'works' | 'scheduled' | 'integrations'
export type ProblemCopy = Awaited<ReturnType<typeof getTranslations<'console.problems'>>>
export type ProblemKey = Parameters<ProblemCopy>[0]
export type ProblemTime = 'checked' | 'read' | 'started' | 'due' | 'success'
export interface ProblemFact {
  text: string
  at?: string | null
  time?: ProblemTime
}
export interface OverviewProblem {
  key: string
  source: ProblemSource
  name: string
  technicalId?: string
  priority: number | null
  facts: ProblemFact[]
  href: string
  action: ProblemKey
  guide: string
  metricAt?: string | null
}
export interface OverviewSources {
  overview: AdminOverviewResponse | null
  queues: AdminQueuesResponse | null
  works: WorkSummary[] | null
  scheduled: ScheduledJobsResponse | null
  integrations: IntegrationsResponse | null
}
export interface ProblemContext {
  entries: Map<string, OverviewProblem>
  t: ProblemCopy
  locale: string
  name: (kind: 'job' | 'integration' | 'dependency', id: string, fallback: string) => string
  limitations: Set<string>
}
export function problemFact(
  ctx: ProblemContext,
  entry: Omit<OverviewProblem, 'facts'>,
  fact: ProblemFact
) {
  const existing = ctx.entries.get(entry.key)
  if (!existing) {
    ctx.entries.set(entry.key, { ...entry, facts: [fact] })
    return
  }
  if (
    entry.priority !== null &&
    (existing.priority === null || entry.priority < existing.priority)
  ) {
    Object.assign(existing, entry, { facts: existing.facts })
  }
  if (
    !existing.facts.some(
      (item) => item.text === fact.text && item.at === fact.at && item.time === fact.time
    )
  )
    existing.facts.push(fact)
}
export function workCount(ctx: ProblemContext, count: { value: number; truncated: boolean }) {
  const value = new Intl.NumberFormat(ctx.locale).format(count.value)
  return count.truncated ? ctx.t('atLeast', { count: value }) : value
}
export function workName(
  ctx: ProblemContext,
  labels: Record<string, string> | undefined,
  fallback: string
) {
  return labels?.[ctx.locale] ?? labels?.en ?? fallback
}
