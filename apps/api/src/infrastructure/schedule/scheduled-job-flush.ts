import type { Lane } from './scheduled-job-pending.js'

/** Event lane: daily runs, at most once a second. Frequent lane: summaries, once a minute. */
const MIN_INTERVAL_MS: Record<Lane, number> = { event: 1000, frequent: 60_000 }
const BACKOFF_START_MS = 5000
const BACKOFF_MAX_MS = 60_000
const DEGRADE_AFTER = 5
const DEGRADED_MS = 5 * 60_000

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}

/** What the flush control needs from its owner; it knows nothing about evidence or SQL. */
export interface FlushHost {
  hasPending(lane: Lane): boolean
  /** True only when a connection is free or can be opened without making anyone wait. */
  admitted(): boolean
  /** Writes one lane; rejects when the write failed (the owner has already kept the data). */
  write(lane: Lane): Promise<void>
  onDegraded(reason: string): void
}

/**
 * When to write: single-flight (one physical write at a time), a minimum interval per lane, an
 * exponential retry after a failure and a degraded mode after repeated failures. The recorder
 * stays responsible for what is written; nothing here waits for the database before a job runs.
 */
export class FlushControl {
  private readonly nextAllowed: Record<Lane, number> = { event: 0, frequent: 0 }
  private readonly failures: Record<Lane, number> = { event: 0, frequent: 0 }
  private readonly timers = new Map<Lane, NodeJS.Timeout>()
  private writing = false
  private degradedUntil = 0
  private closed = false

  constructor(private readonly host: FlushHost) {}

  /** While degraded the owner keeps only failures and partial results. */
  get degraded(): boolean {
    return Date.now() < this.degradedUntil
  }

  kick(lane: Lane): void {
    this.schedule(lane, Math.max(0, this.nextAllowed[lane] - Date.now()))
  }

  close(): void {
    this.closed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private schedule(lane: Lane, wait: number): void {
    if (this.closed || this.timers.has(lane)) return
    const timer = setTimeout(() => {
      this.timers.delete(lane)
      void this.flush(lane)
    }, wait)
    timer.unref()
    this.timers.set(lane, timer)
  }

  private async flush(lane: Lane): Promise<void> {
    if (this.writing || !this.host.hasPending(lane)) {
      if (this.writing && this.host.hasPending(lane)) this.schedule(lane, MIN_INTERVAL_MS.event)
      return
    }
    if (!this.host.admitted()) {
      this.failed(lane, 'pool_busy')
      return
    }
    this.writing = true
    try {
      await this.host.write(lane)
      this.failures[lane] = 0
      this.nextAllowed[lane] = Date.now() + MIN_INTERVAL_MS[lane]
    } catch (error) {
      this.failed(lane, errorName(error))
    } finally {
      this.writing = false
    }
    if (this.host.hasPending(lane)) this.kick(lane)
    const other: Lane = lane === 'event' ? 'frequent' : 'event'
    if (this.host.hasPending(other)) this.kick(other)
  }

  private failed(lane: Lane, reason: string): void {
    this.failures[lane] += 1
    if (this.failures[lane] >= DEGRADE_AFTER) {
      this.degradedUntil = Date.now() + DEGRADED_MS
      this.failures[lane] = 0
      this.host.onDegraded(reason)
    }
    const delay = Math.min(
      BACKOFF_START_MS * 2 ** Math.max(0, this.failures[lane] - 1),
      BACKOFF_MAX_MS
    )
    this.nextAllowed[lane] = Date.now() + Math.max(delay, MIN_INTERVAL_MS[lane])
    this.schedule(lane, this.nextAllowed[lane] - Date.now())
  }
}
