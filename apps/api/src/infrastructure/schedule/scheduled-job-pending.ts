import type { ScheduledSkipReason, ScheduledSummary } from '@amcore/shared'

import type { ScheduledJobCadence } from './scheduled-job.js'

export type EvidenceKind = 'success' | 'partial' | 'failure' | 'skip'

/** One finished attempt. `startMono` / `endMono` are process-monotonic; the store converts them to DB time. */
export interface Evidence {
  kind: EvidenceKind
  jobId: string
  cadence: ScheduledJobCadence
  runId: string
  startMono: number
  endMono: number
  durationMs: number
  code: string | null
  summary: ScheduledSummary | null
  skipReason: ScheduledSkipReason | null
  /** Success only: the planned fire after this run, and the config it was judged under. */
  dueAt: Date | null
  configVersion: string
  /** Display only: the next planned fire when the run ended. */
  nextFireAt: Date | null
}

export interface RunStart {
  jobId: string
  runId: string
  startMono: number
  /** Open runs older than this are reported as abandoned. */
  maxRuntimeMs: number
}

export interface RunFinish {
  jobId: string
  runId: string
  outcome: 'success' | 'partial' | 'failed'
  endMono: number
  durationMs: number
  code: string | null
  summary: ScheduledSummary | null
}

export type Lane = 'frequent' | 'event'

export interface Snapshot {
  lane: Lane
  evidence: Evidence[]
  starts: RunStart[]
  finishes: RunFinish[]
  /** Observations lost per job since the last write; reported with the next successful one. */
  dropped: Map<string, number>
}

/** Newer wins; equal start times are ordered by run id, so the winner is deterministic. */
export function isNewer(a: Pick<Evidence, 'startMono' | 'runId'>, b: typeof a): boolean {
  return a.startMono > b.startMono || (a.startMono === b.startMono && a.runId > b.runId)
}

const laneOf = (cadence: ScheduledJobCadence): Lane => (cadence === 'daily' ? 'event' : 'frequent')

/**
 * Not-yet-written evidence. Its size is bounded by the number of jobs, not by the number of
 * ticks: one slot per job and kind, and at most `OPEN_RUNS_PER_JOB` unfinished runs per job.
 * Merging keeps the newest evidence of each kind, so a failure never displaces a success.
 */
export class PendingEvidence {
  static readonly OPEN_RUNS_PER_JOB = 3

  private evidence = new Map<string, Evidence>()
  private starts = new Map<string, RunStart>()
  private finishes = new Map<string, RunFinish>()
  private dropped = new Map<string, { lane: Lane; count: number }>()

  put(next: Evidence): void {
    const key = `${next.jobId}:${next.kind}`
    const current = this.evidence.get(key)
    if (!current || isNewer(next, current)) this.evidence.set(key, next)
  }

  /** False when this job already has the maximum number of unfinished runs in flight. */
  startRun(start: RunStart): boolean {
    const open = [...this.starts.values()].filter((item) => item.jobId === start.jobId).length
    if (open >= PendingEvidence.OPEN_RUNS_PER_JOB) {
      this.drop(start.jobId, 'event')
      return false
    }
    this.starts.set(start.runId, start)
    return true
  }

  finishRun(finish: RunFinish): void {
    this.finishes.set(finish.runId, finish)
  }

  drop(jobId: string, lane: Lane, count = 1): void {
    const current = this.dropped.get(jobId)
    this.dropped.set(jobId, { lane, count: (current?.count ?? 0) + count })
  }

  has(lane: Lane): boolean {
    return (
      [...this.evidence.values()].some((item) => laneOf(item.cadence) === lane) ||
      (lane === 'event' && (this.starts.size > 0 || this.finishes.size > 0)) ||
      [...this.dropped.values()].some((item) => item.lane === lane)
    )
  }

  /** Moves one lane's entries out. The other lane stays pending untouched. */
  take(lane: Lane): Snapshot {
    const evidence: Evidence[] = []
    for (const [key, item] of this.evidence) {
      if (laneOf(item.cadence) !== lane) continue
      evidence.push(item)
      this.evidence.delete(key)
    }
    const dropped = new Map<string, number>()
    for (const [jobId, item] of this.dropped) {
      if (item.lane !== lane) continue
      dropped.set(jobId, item.count)
      this.dropped.delete(jobId)
    }
    const snapshot: Snapshot = {
      lane,
      evidence,
      starts: lane === 'event' ? [...this.starts.values()] : [],
      finishes: lane === 'event' ? [...this.finishes.values()] : [],
      dropped,
    }
    if (lane === 'event') {
      this.starts.clear()
      this.finishes.clear()
    }
    return snapshot
  }

  /** A failed write returns its snapshot; entries that were superseded meanwhile lose to the newer ones. */
  restore(snapshot: Snapshot): void {
    for (const item of snapshot.evidence) this.put(item)
    for (const start of snapshot.starts)
      if (!this.starts.has(start.runId)) this.starts.set(start.runId, start)
    for (const finish of snapshot.finishes)
      if (!this.finishes.has(finish.runId)) this.finishes.set(finish.runId, finish)
    for (const [jobId, count] of snapshot.dropped) this.drop(jobId, snapshot.lane, count)
  }
}
