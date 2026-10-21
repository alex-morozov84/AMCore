import type {
  ScheduledConfig,
  ScheduledFreshness,
  ScheduledJob,
  ScheduledResult,
  ScheduledSkipReason,
  ScheduledSummary,
} from '@amcore/shared'

import {
  cadenceOf,
  type ScheduledJobDefinition,
} from '../../infrastructure/schedule/scheduled-job.js'

/** The stored evidence of one job, as read from `scheduled_job_summaries`. */
export interface SummaryRow {
  firstRegisteredAt: Date
  lastRegisteredAt: Date
  configVersion: string
  scheduleTimeZone: string | null
  enabled: boolean
  disabledReason: string | null
  nextFireAt: Date | null
  baselineDueAt: Date | null
  droppedEvents: number
  success: Snapshot & { dueAt: Date | null; configVersion: string | null }
  partial: Snapshot
  failure: Snapshot
  skip: { startedAt: Date | null; runId: string | null; reason: string | null }
}

export interface Snapshot {
  startedAt: Date | null
  runId: string | null
  finishedAt: Date | null
  durationMs: number | null
  code: string | null
  summary: ScheduledSummary | null
}

/** The newest run of a daily job that has no recorded end. */
export interface UnfinishedRun {
  startedAt: Date
  runId: string
  abandoned: boolean
}

/** The order of runs everywhere: start time, then run id, the same key the writer merges by. */
interface RunKey {
  at: number
  runId: string
}
const isAfter = (a: RunKey, b: RunKey): boolean =>
  a.at > b.at || (a.at === b.at && a.runId > b.runId)

const iso = (date: Date): string => date.toISOString()

function configOf(row: SummaryRow | undefined): ScheduledConfig {
  if (!row) return { state: 'not_reported' }
  if (!row.enabled)
    return {
      state: 'disabled',
      reason: row.disabledReason ?? 'disabled',
      reportedAt: iso(row.lastRegisteredAt),
    }
  return {
    state: 'enabled',
    reportedAt: iso(row.lastRegisteredAt),
    scheduleTimeZone: row.scheduleTimeZone,
  }
}

type Settled = {
  kind: 'success' | 'partial' | 'failed'
  startedAt: Date
  runId: string
  snapshot: Snapshot
}

/** The newest of the three outcome snapshots by `(startedAt, runId)`. */
function latestOutcome(row: SummaryRow): Settled | null {
  const candidates: Settled[] = []
  const add = (kind: Settled['kind'], snapshot: Snapshot): void => {
    if (snapshot.startedAt && snapshot.runId)
      candidates.push({ kind, startedAt: snapshot.startedAt, runId: snapshot.runId, snapshot })
  }
  add('success', row.success)
  add('partial', row.partial)
  add('failed', row.failure)
  candidates.sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime() || (a.runId < b.runId ? 1 : -1)
  )
  return candidates[0] ?? null
}

/**
 * Axis 2. A run is `running` only while inside its maximum runtime, `unknown` once it is not. The
 * key of the run that is shown comes with it, so a skip can be compared by the same order.
 */
function resultOf(
  definition: ScheduledJobDefinition,
  row: SummaryRow | undefined,
  unfinished: UnfinishedRun | undefined,
  now: Date
): { result: ScheduledResult; key: RunKey | null } {
  const outcome = row ? latestOutcome(row) : null
  const outcomeKey = outcome ? { at: outcome.startedAt.getTime(), runId: outcome.runId } : null
  if (unfinished && cadenceOf(definition) === 'daily') {
    const key = { at: unfinished.startedAt.getTime(), runId: unfinished.runId }
    const live = !unfinished.abandoned && now.getTime() - key.at <= definition.graceMs
    if (live) return { result: { state: 'running', startedAt: iso(unfinished.startedAt) }, key }
    if (!outcomeKey || isAfter(key, outcomeKey))
      return { result: { state: 'unknown', startedAt: iso(unfinished.startedAt) }, key }
  }
  if (!outcome || !outcomeKey) return { result: { state: 'none' }, key: null }
  return {
    result: {
      state: outcome.kind,
      startedAt: iso(outcome.startedAt),
      durationMs: outcome.snapshot.durationMs ?? 0,
      code: outcome.snapshot.code,
      summary: outcome.snapshot.summary,
    },
    key: outcomeKey,
  }
}

/** Axis 3. Partial runs and skips never move the due time, so they never make a job look fresh. */
function freshnessOf(
  definition: ScheduledJobDefinition,
  row: SummaryRow | undefined,
  config: ScheduledConfig,
  now: Date
): ScheduledFreshness {
  if (!row || config.state !== 'enabled') return { state: 'unknown', dueAt: null }
  if (cadenceOf(definition) === 'daily') {
    const dueAt =
      row.success.configVersion === row.configVersion ? row.success.dueAt : row.baselineDueAt
    if (!dueAt) return { state: 'unknown', dueAt: null }
    const stale = now.getTime() > dueAt.getTime() + definition.graceMs
    return { state: stale ? 'stale' : 'fresh', dueAt: iso(dueAt) }
  }
  const base = row.success.finishedAt ?? row.firstRegisteredAt
  const dueAt = new Date(base.getTime() + (definition.staleAfterMs ?? 0))
  return { state: now.getTime() > dueAt.getTime() ? 'stale' : 'fresh', dueAt: iso(dueAt) }
}

/** Shown only when newer, by the run key, than the result it would sit beside. */
function skipOf(
  row: SummaryRow | undefined,
  shown: RunKey | null
): { at: string; reason: ScheduledSkipReason } | null {
  const skip = row?.skip
  if (!skip?.startedAt || !skip.reason) return null
  const key = { at: skip.startedAt.getTime(), runId: skip.runId ?? '' }
  if (shown && !isAfter(key, shown)) return null
  return { at: iso(skip.startedAt), reason: skip.reason as ScheduledSkipReason }
}

export function toScheduledJob(
  definition: ScheduledJobDefinition,
  row: SummaryRow | undefined,
  unfinished: UnfinishedRun | undefined,
  now: Date
): ScheduledJob {
  const config = configOf(row)
  const { result, key } = resultOf(definition, row, unfinished, now)
  return {
    id: definition.id,
    family: definition.family,
    cadence: cadenceOf(definition),
    schedule: definition.schedule,
    config,
    result,
    skip: skipOf(row, key),
    freshness: freshnessOf(definition, row, config, now),
    lastSuccess: row?.success.startedAt
      ? {
          startedAt: iso(row.success.startedAt),
          durationMs: row.success.durationMs ?? 0,
          underCurrentConfig: row.success.configVersion === row.configVersion,
        }
      : null,
    nextFireAt: row?.nextFireAt ? iso(row.nextFireAt) : null,
    droppedEvents: row?.droppedEvents ?? 0,
  }
}
