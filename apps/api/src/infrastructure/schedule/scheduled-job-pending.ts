import type { ScheduledSkipReason, ScheduledSummary } from '@amcore/shared'

import type { ScheduledJobCadence } from './scheduled-job.js'

export type EvidenceKind = 'success' | 'partial' | 'failure' | 'skip'

/**
 * A point where the process monotonic clock met the database clock. Every event of one run
 * converts its monotonic times with the same anchor, so the run keeps one canonical key
 * (`startedAt`, `runId`) across its start, its finish and any retry, however long each clock read took.
 */
export interface Anchor {
  /** Database time in ms. */
  db: number
  /** Process monotonic time (ms) when that database time was read. */
  mono: number
}

/** Shared by reference by every event of one run; filled by the first write that needs it. */
export interface RunClock {
  anchor: Anchor | null
}

/** One finished attempt. `startMono` / `endMono` are process-monotonic; the writer converts them. */
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
  clock: RunClock
}

export interface RunStart {
  jobId: string
  runId: string
  startMono: number
  /** Open runs older than this are reported as abandoned. */
  maxRuntimeMs: number
  clock: RunClock
}

export interface RunFinish {
  jobId: string
  runId: string
  outcome: 'success' | 'partial' | 'failed'
  endMono: number
  durationMs: number
  code: string | null
  summary: ScheduledSummary | null
  /** The start time of the run, so the finish can be keyed like its start. */
  startMono: number
  clock: RunClock
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

interface RunRecord {
  jobId: string
  start?: RunStart
  finish?: RunFinish
}

/**
 * Not-yet-written evidence. Its size is bounded by the number of jobs, not by the number of
 * ticks: one slot per job and kind, and at most `RECORDS_PER_JOB` run records per job (which
 * includes everything restored after a failed write). A run can be tracked only while the job has
 * fewer than `OPEN_RUNS_PER_JOB` unfinished tracked runs, and a finish is accepted only for a run
 * whose start was accepted. Merging keeps the newest evidence of each kind, so a failure never
 * displaces a success.
 */
export class PendingEvidence {
  static readonly OPEN_RUNS_PER_JOB = 3
  static readonly RECORDS_PER_JOB = 10

  private evidence = new Map<string, Evidence>()
  private records = new Map<string, RunRecord>()
  /** Tracked, unfinished runs (pending or already written), so a finish knows its start was accepted. */
  private open = new Map<string, { jobId: string; startMono: number; maxRuntimeMs: number }>()
  private dropped = new Map<string, { lane: Lane; count: number }>()

  put(next: Evidence): void {
    const key = `${next.jobId}:${next.kind}`
    const current = this.evidence.get(key)
    if (!current || isNewer(next, current)) this.evidence.set(key, next)
  }

  /** False when the run is not tracked; the refusal is counted and the job is unaffected. */
  startRun(start: RunStart): boolean {
    this.expireOpen(start.jobId, start.startMono)
    const open = [...this.open.values()].filter((item) => item.jobId === start.jobId).length
    if (open >= PendingEvidence.OPEN_RUNS_PER_JOB || !this.room(start.jobId)) {
      this.drop(start.jobId, 'event')
      return false
    }
    this.records.set(start.runId, { jobId: start.jobId, start })
    this.open.set(start.runId, {
      jobId: start.jobId,
      startMono: start.startMono,
      maxRuntimeMs: start.maxRuntimeMs,
    })
    return true
  }

  /** False when the start was never accepted: there is nothing to close and nothing to record. */
  finishRun(finish: RunFinish): boolean {
    if (!this.open.has(finish.runId)) return false
    this.open.delete(finish.runId)
    const record = this.records.get(finish.runId)
    if (record) {
      record.finish = finish
      return true
    }
    if (!this.room(finish.jobId)) {
      this.drop(finish.jobId, 'event')
      return false
    }
    this.records.set(finish.runId, { jobId: finish.jobId, finish })
    return true
  }

  drop(jobId: string, lane: Lane, count = 1): void {
    const current = this.dropped.get(jobId)
    this.dropped.set(jobId, { lane, count: (current?.count ?? 0) + count })
  }

  has(lane: Lane): boolean {
    return (
      [...this.evidence.values()].some((item) => laneOf(item.cadence) === lane) ||
      (lane === 'event' && this.records.size > 0) ||
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
    const starts: RunStart[] = []
    const finishes: RunFinish[] = []
    if (lane === 'event') {
      for (const record of this.records.values()) {
        if (record.start) starts.push(record.start)
        if (record.finish) finishes.push(record.finish)
      }
      this.records.clear()
    }
    return { lane, evidence, starts, finishes, dropped }
  }

  /**
   * A failed write returns its snapshot. Evidence is merged by key order. Run records go back only
   * while the job has room, so a long outage can never grow the queue; what does not fit is counted
   * as a lost observation.
   */
  restore(snapshot: Snapshot): void {
    for (const item of snapshot.evidence) this.put(item)
    for (const start of snapshot.starts) this.restoreRecord(start.jobId, start.runId, { start })
    for (const finish of snapshot.finishes)
      this.restoreRecord(finish.jobId, finish.runId, { finish })
    for (const [jobId, count] of snapshot.dropped) this.drop(jobId, snapshot.lane, count)
  }

  private restoreRecord(
    jobId: string,
    runId: string,
    part: { start?: RunStart; finish?: RunFinish }
  ): void {
    const record = this.records.get(runId)
    if (record) {
      record.start ??= part.start
      record.finish ??= part.finish
      return
    }
    if (!this.room(jobId)) {
      this.drop(jobId, 'event')
      return
    }
    this.records.set(runId, { jobId, ...part })
  }

  /** True when a record fits; evicts the oldest finished record of the job when the job is full. */
  private room(jobId: string): boolean {
    const own = [...this.records.entries()].filter(([, record]) => record.jobId === jobId)
    if (own.length < PendingEvidence.RECORDS_PER_JOB) return true
    const evictable = own.find(([, record]) => record.finish !== undefined)
    if (!evictable) return false
    this.records.delete(evictable[0])
    this.drop(jobId, 'event')
    return true
  }

  /** A tracked run older than its maximum runtime is treated as abandoned and frees its slot. */
  private expireOpen(jobId: string, now: number): void {
    for (const [runId, item] of this.open) {
      if (item.jobId === jobId && now - item.startMono > item.maxRuntimeMs) this.open.delete(runId)
    }
  }
}
