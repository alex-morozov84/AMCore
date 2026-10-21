import { Injectable } from '@nestjs/common'

import type { ScheduledJobsResponse, ScheduledRunsResponse, ScheduledSummary } from '@amcore/shared'
import { SCHEDULED_HISTORY_PAGE } from '@amcore/shared'

import { NotFoundException } from '../../common/exceptions/index.js'
import type { ScheduledJobSummary } from '../../generated/prisma/client.js'
import { cadenceOf } from '../../infrastructure/schedule/scheduled-job.js'
import { SCHEDULED_JOBS } from '../../infrastructure/schedule/scheduled-jobs.catalogue.js'
import { PrismaService } from '../../prisma/index.js'

import {
  type Snapshot,
  type SummaryRow,
  toScheduledJob,
  type UnfinishedRun,
} from './scheduled-job-status.js'

const asSummary = (value: unknown): ScheduledSummary | null =>
  value && typeof value === 'object' ? (value as ScheduledSummary) : null

function snapshot(row: ScheduledJobSummary, kind: 'success' | 'partial' | 'failure'): Snapshot {
  const column = (name: string): unknown => row[`${kind}${name}` as keyof ScheduledJobSummary]
  return {
    startedAt: column('StartedAt') as Date | null,
    runId: column('RunId') as string | null,
    finishedAt: column('FinishedAt') as Date | null,
    durationMs: column('DurationMs') as number | null,
    code: column('Code') as string | null,
    summary: asSummary(column('Summary')),
  }
}

function toRow(row: ScheduledJobSummary): SummaryRow {
  return {
    firstRegisteredAt: row.firstRegisteredAt,
    lastRegisteredAt: row.lastRegisteredAt,
    configVersion: row.configVersion,
    scheduleTimeZone: row.scheduleTimeZone,
    enabled: row.enabled,
    disabledReason: row.disabledReason,
    nextFireAt: row.nextFireAt,
    baselineDueAt: row.baselineDueAt,
    droppedEvents: row.droppedEvents,
    success: {
      ...snapshot(row, 'success'),
      dueAt: row.successDueAt,
      configVersion: row.successConfigVersion,
    },
    partial: snapshot(row, 'partial'),
    failure: snapshot(row, 'failure'),
    skip: { startedAt: row.skipStartedAt, runId: row.skipRunId, reason: row.skipReason },
  }
}

/**
 * Console read of recorded scheduled-job evidence. The list comes from the code-owned catalogue, so
 * a job no worker has reported is `not_reported` rather than missing. Statuses are computed here, at
 * read time and on the database clock, and nothing is written.
 */
@Injectable()
export class AdminScheduledJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ScheduledJobsResponse> {
    const [clock] = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const now = clock?.now ?? new Date()
    const [rows, unfinished] = await Promise.all([
      this.prisma.scheduledJobSummary.findMany({ take: 128 }),
      // At most 3 open + 7 abandoned rows per job (table caps), so this read is bounded.
      this.prisma.scheduledJobRun.findMany({
        where: { OR: [{ outcome: null }, { outcome: 'unknown' }] },
        orderBy: [{ startedAt: 'desc' }, { runId: 'desc' }],
        take: 1000,
        select: { jobId: true, runId: true, startedAt: true, outcome: true },
      }),
    ])
    const byJob = new Map(rows.map((row) => [row.jobId, toRow(row)]))
    const latestUnfinished = new Map<string, UnfinishedRun>()
    for (const run of unfinished) {
      if (!latestUnfinished.has(run.jobId))
        latestUnfinished.set(run.jobId, {
          startedAt: run.startedAt,
          runId: run.runId,
          abandoned: run.outcome === 'unknown',
        })
    }
    return {
      checkedAt: now.toISOString(),
      jobs: SCHEDULED_JOBS.map((definition) =>
        toScheduledJob(
          definition,
          byJob.get(definition.id),
          latestUnfinished.get(definition.id),
          now
        )
      ),
    }
  }

  async runs(jobId: string): Promise<ScheduledRunsResponse> {
    const definition = SCHEDULED_JOBS.find((job) => job.id === jobId)
    if (!definition || cadenceOf(definition) !== 'daily')
      throw new NotFoundException('Scheduled job has no run history')
    const [clock] = await this.prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const now = clock?.now ?? new Date()
    const rows = await this.prisma.scheduledJobRun.findMany({
      where: { jobId },
      orderBy: [{ startedAt: 'desc' }, { runId: 'desc' }],
      take: SCHEDULED_HISTORY_PAGE + 1,
    })
    return {
      jobId,
      checkedAt: now.toISOString(),
      truncated: rows.length > SCHEDULED_HISTORY_PAGE,
      runs: rows.slice(0, SCHEDULED_HISTORY_PAGE).map((run) => {
        const open = run.outcome === null
        const live = open && now.getTime() - run.startedAt.getTime() <= definition.graceMs
        const state =
          run.outcome === 'success' || run.outcome === 'partial' || run.outcome === 'failed'
            ? run.outcome
            : live
              ? 'running'
              : 'unknown'
        return {
          runId: run.runId,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          state,
          durationMs: run.durationMs,
          code: run.code,
          summary: asSummary(run.summary),
        }
      }),
    }
  }
}
