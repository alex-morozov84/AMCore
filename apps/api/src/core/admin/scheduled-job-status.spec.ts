import type { ScheduledJobDefinition } from '../../infrastructure/schedule/scheduled-job'

import { type SummaryRow, toScheduledJob } from './scheduled-job-status'

const HOUR = 3_600_000
const NOW = new Date('2026-10-21T14:05:00.000Z')
const ago = (hours: number): Date => new Date(NOW.getTime() - hours * HOUR)
const ahead = (hours: number): Date => new Date(NOW.getTime() + hours * HOUR)

const daily: ScheduledJobDefinition = {
  id: 'cleanup',
  family: 'singleton',
  schedule: { kind: 'cron', expression: '0 0 2 * * *', timeZone: null },
  graceMs: 30 * 60_000,
}
const frequent: ScheduledJobDefinition = {
  id: 'notification-recovery',
  family: 'per-replica',
  schedule: { kind: 'cron', expression: '*/30 * * * * *', timeZone: null },
  graceMs: 0,
  staleAfterMs: 5 * 60_000,
}

type Snap = SummaryRow['partial']
const empty: Snap = {
  startedAt: null,
  runId: null,
  finishedAt: null,
  durationMs: null,
  code: null,
  summary: null,
}
const snapshot = (startedAt: Date, extra: Partial<Snap> = {}): Snap => ({
  ...empty,
  startedAt,
  runId: `run-${startedAt.getTime()}`,
  finishedAt: new Date(startedAt.getTime() + 4000),
  durationMs: 4000,
  ...extra,
})

function row(over: Partial<SummaryRow> = {}): SummaryRow {
  return {
    firstRegisteredAt: ago(100),
    lastRegisteredAt: ago(1),
    configVersion: 'v1',
    scheduleTimeZone: 'UTC',
    enabled: true,
    disabledReason: null,
    nextFireAt: ahead(12),
    baselineDueAt: ahead(12),
    droppedEvents: 0,
    success: { ...empty, dueAt: null, configVersion: null },
    partial: empty,
    failure: empty,
    skip: { startedAt: null, runId: null, reason: null },
    ...over,
  }
}

const succeededAt = (startedAt: Date, dueAt: Date, configVersion = 'v1') => ({
  ...snapshot(startedAt),
  dueAt,
  configVersion,
})

describe('toScheduledJob — configuration axis', () => {
  it('reports a job no worker registered as not_reported with unknown freshness', () => {
    const job = toScheduledJob(daily, undefined, undefined, NOW)
    expect(job.config).toEqual({ state: 'not_reported' })
    expect(job.result).toEqual({ state: 'none' })
    expect(job.freshness).toEqual({ state: 'unknown', dueAt: null })
  })

  it('reports a job a worker turned off as disabled, never as stale', () => {
    const job = toScheduledJob(
      daily,
      row({ enabled: false, disabledReason: 'geoip_disabled', baselineDueAt: ago(5) }),
      undefined,
      NOW
    )
    expect(job.config).toMatchObject({ state: 'disabled', reason: 'geoip_disabled' })
    expect(job.freshness.state).toBe('unknown')
  })
})

describe('toScheduledJob — daily freshness', () => {
  it('is fresh after a success whose next due time is still ahead', () => {
    const job = toScheduledJob(
      daily,
      row({ success: succeededAt(ago(12), ahead(12)) }),
      undefined,
      NOW
    )
    expect(job.result.state).toBe('success')
    expect(job.freshness.state).toBe('fresh')
  })

  it('turns stale once the due time plus grace has passed with no newer success', () => {
    const job = toScheduledJob(
      daily,
      row({ success: succeededAt(ago(40), ago(16)) }),
      undefined,
      NOW
    )
    expect(job.freshness).toEqual({ state: 'stale', dueAt: ago(16).toISOString() })
  })

  it('stays inside the grace window right after the due time', () => {
    const due = new Date(NOW.getTime() - 10 * 60_000)
    const job = toScheduledJob(daily, row({ success: succeededAt(ago(24), due) }), undefined, NOW)
    expect(job.freshness.state).toBe('fresh')
  })

  it('keeps failing for three days stale: failures never move the due time', () => {
    const job = toScheduledJob(
      daily,
      row({
        success: succeededAt(ago(100), ago(76)),
        failure: snapshot(ago(12), { code: 'all_buckets_failed' }),
      }),
      undefined,
      NOW
    )
    expect(job.result).toMatchObject({ state: 'failed', code: 'all_buckets_failed' })
    expect(job.freshness.state).toBe('stale')
  })

  it('shows partial and stale together: a partial run is not a success', () => {
    const job = toScheduledJob(
      daily,
      row({
        success: succeededAt(ago(50), ago(26)),
        partial: snapshot(ago(2), { code: 'bucket_failed' }),
      }),
      undefined,
      NOW
    )
    expect(job.result.state).toBe('partial')
    expect(job.freshness.state).toBe('stale')
    expect(job.lastSuccess?.startedAt).toBe(ago(50).toISOString())
  })

  it('does not let a late success of yesterday’s run satisfy today’s due time', () => {
    // Yesterday’s run finished after today’s 02:00: its due time (today 02:00) is already past.
    const job = toScheduledJob(
      daily,
      row({ success: succeededAt(ago(23), ago(12)) }),
      undefined,
      NOW
    )
    expect(job.freshness.state).toBe('stale')
  })

  it('judges a job that never succeeded by the baseline, which a restart does not move', () => {
    const waiting = toScheduledJob(daily, row({ baselineDueAt: ahead(3) }), undefined, NOW)
    expect(waiting.result).toEqual({ state: 'none' })
    expect(waiting.freshness.state).toBe('fresh')
    const missed = toScheduledJob(daily, row({ baselineDueAt: ago(5) }), undefined, NOW)
    expect(missed.freshness.state).toBe('stale')
  })

  it('ignores a success recorded under another schedule and judges by the new baseline', () => {
    const job = toScheduledJob(
      daily,
      row({
        configVersion: 'v2',
        baselineDueAt: ahead(6),
        success: succeededAt(ago(12), ago(100), 'v1'),
      }),
      undefined,
      NOW
    )
    expect(job.freshness.state).toBe('fresh')
    expect(job.lastSuccess?.underCurrentConfig).toBe(false)
  })
})

describe('toScheduledJob — result axis', () => {
  it('reports a run inside its maximum runtime as running', () => {
    const job = toScheduledJob(
      daily,
      row(),
      { startedAt: new Date(NOW.getTime() - 5 * 60_000), abandoned: false },
      NOW
    )
    expect(job.result).toMatchObject({ state: 'running' })
  })

  it('reports an open run past its maximum runtime as unknown, newer than the last outcome', () => {
    const job = toScheduledJob(
      daily,
      row({ success: succeededAt(ago(74), ago(50)) }),
      { startedAt: ago(3), abandoned: false },
      NOW
    )
    expect(job.result).toEqual({ state: 'unknown', startedAt: ago(3).toISOString() })
  })

  it('keeps the recorded outcome when an abandoned run is older than it', () => {
    const job = toScheduledJob(
      daily,
      row({ success: succeededAt(ago(2), ahead(22)) }),
      { startedAt: ago(30), abandoned: true },
      NOW
    )
    expect(job.result.state).toBe('success')
  })

  it('shows a skip only when it is newer than the shown result', () => {
    const skipped = { startedAt: ago(1), runId: 'skip-1', reason: 'busy' }
    const hidden = toScheduledJob(
      frequent,
      row({ success: succeededAt(ago(0.01), ahead(1)), skip: skipped }),
      undefined,
      NOW
    )
    expect(hidden.skip).toBeNull()
    const shown = toScheduledJob(
      frequent,
      row({ success: succeededAt(ago(2), ahead(1)), skip: skipped }),
      undefined,
      NOW
    )
    expect(shown.skip).toEqual({ at: ago(1).toISOString(), reason: 'busy' })
  })
})

describe('toScheduledJob — frequent freshness', () => {
  it('is stale when no completed cycle was recorded within staleAfter', () => {
    const fresh = toScheduledJob(
      frequent,
      row({ success: { ...succeededAt(ago(0.05), ahead(1)), finishedAt: ago(0.05) } }),
      undefined,
      NOW
    )
    expect(fresh.freshness.state).toBe('fresh')
    const stale = toScheduledJob(
      frequent,
      row({ success: { ...succeededAt(ago(0.2), ahead(1)), finishedAt: ago(0.2) } }),
      undefined,
      NOW
    )
    expect(stale.freshness.state).toBe('stale')
  })

  it('counts from the first registration when nothing has completed yet', () => {
    const job = toScheduledJob(frequent, row({ firstRegisteredAt: ago(2) }), undefined, NOW)
    expect(job.freshness.state).toBe('stale')
  })

  it('does not track a current run for a frequent job', () => {
    const job = toScheduledJob(frequent, row(), { startedAt: ago(1), abandoned: false }, NOW)
    expect(job.result.state).toBe('none')
  })
})
