import { randomUUID } from 'node:crypto'

import { Injectable, type OnModuleDestroy, Optional } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'

import { PrismaService } from '../../prisma/index.js'

import {
  cadenceOf,
  configVersionOf,
  type ScheduledJobDefinition,
  type ScheduledJobResult,
} from './scheduled-job.js'
import { errorName, FlushControl } from './scheduled-job-flush.js'
import {
  type Anchor,
  type Evidence,
  type Lane,
  PendingEvidence,
  type RunClock,
} from './scheduled-job-pending.js'
import type { Registration } from './scheduled-job-registration.sql.js'
import { writeRegistration, writeSnapshot } from './scheduled-job-writer.js'

/** A clock anchor older than this is replaced by the next sample, for runs that begin after it. */
const ANCHOR_MAX_AGE_MS = 60 * 60_000

export class ScheduledRun {
  /** Shared by every event of this run, so its key stays the same across start, finish and retry. */
  readonly clock: RunClock = { anchor: null }
  /** False when the recorder refused to track the run (degraded or over its limits). */
  tracked = true

  constructor(
    readonly runId: string,
    readonly startMono: number,
    /** The planned fire after this run started: the time the next success is required by. */
    readonly dueAt: Date | null
  ) {}
}

/**
 * Per-process recorder of scheduled-job evidence. `begin` and `finish` never wait for the
 * database: they update bounded in-memory state, and one single-flight writer persists it. A
 * lost write loses an observation, never a job run. Registration of the catalogue travels the same
 * path as evidence, so it is admitted, bounded and retried like any other write.
 */
@Injectable()
export class ScheduledJobRecorder implements OnModuleDestroy {
  private readonly pending = new PendingEvidence()
  private readonly definitions = new Map<string, ScheduledJobDefinition>()
  private registration: Registration[] | null = null
  private anchor: Anchor | null = null
  private readonly flush = new FlushControl({
    hasPending: (lane) =>
      (lane === 'event' && this.registration !== null) || this.pending.has(lane),
    admitted: () => this.admitted(),
    write: (lane) => this.writeLane(lane),
    onDegraded: (reason) =>
      this.logger.warn(
        { event: 'schedule.recorder_degraded', reason },
        'Scheduled job recording degraded: only failures and partial runs are kept for a while'
      ),
  })

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
    @Optional() private readonly scheduler?: SchedulerRegistry
  ) {
    this.logger.setContext(ScheduledJobRecorder.name)
  }

  /**
   * Reports this process's catalogue. It only queues the report: the write happens in the
   * background when a connection is free, is retried with the same backoff as evidence, and is
   * skipped for a pool of one connection. Application start never waits for it.
   */
  registerJobs(
    definitions: ScheduledJobDefinition[],
    disabled: (definition: ScheduledJobDefinition) => string | null
  ): void {
    for (const definition of definitions) this.definitions.set(definition.id, definition)
    this.registration = definitions.map((definition) => ({
      jobId: definition.id,
      configVersion: configVersionOf(definition),
      scheduleTimeZone: this.zoneOf(definition),
      disabledReason: disabled(definition),
      nextFireAt: this.nextFire(definition),
    }))
    this.flush.kick('event')
  }

  begin(definition: ScheduledJobDefinition): ScheduledRun {
    const run = new ScheduledRun(randomUUID(), performance.now(), this.nextFire(definition))
    if (cadenceOf(definition) !== 'daily') return run
    if (this.flush.degraded) {
      // While degraded no new run is tracked: a success could not be kept anyway.
      run.tracked = false
      this.pending.drop(definition.id, 'event')
      return run
    }
    run.tracked = this.pending.startRun({
      jobId: definition.id,
      runId: run.runId,
      startMono: run.startMono,
      maxRuntimeMs: definition.graceMs,
      clock: run.clock,
    })
    if (run.tracked) this.flush.kick('event')
    return run
  }

  finish(definition: ScheduledJobDefinition, run: ScheduledRun, result: ScheduledJobResult): void {
    const endMono = performance.now()
    const durationMs = Math.max(0, Math.round(endMono - run.startMono))
    this.enqueue(this.evidenceOf(definition, run, result, endMono, durationMs))
    // Only a run whose start was accepted gets its row closed; the summary above is separate.
    if (cadenceOf(definition) !== 'daily' || !run.tracked || 'skipped' in result) return
    this.pending.finishRun({
      jobId: definition.id,
      runId: run.runId,
      outcome: result.outcome,
      startMono: run.startMono,
      endMono,
      durationMs,
      code: result.code ?? null,
      summary: result.summary ?? null,
      clock: run.clock,
    })
    this.flush.kick('event')
  }

  private evidenceOf(
    definition: ScheduledJobDefinition,
    run: ScheduledRun,
    result: ScheduledJobResult,
    endMono: number,
    durationMs: number
  ): Evidence {
    const base = {
      jobId: definition.id,
      cadence: cadenceOf(definition),
      runId: run.runId,
      startMono: run.startMono,
      endMono,
      durationMs,
      configVersion: configVersionOf(definition),
      nextFireAt: this.nextFire(definition),
      clock: run.clock,
    }
    if ('skipped' in result)
      return {
        ...base,
        kind: 'skip',
        code: null,
        summary: null,
        skipReason: result.skipped,
        dueAt: null,
      }
    const { outcome } = result
    return {
      ...base,
      kind: outcome === 'failed' ? 'failure' : outcome,
      code: result.code ?? null,
      summary: result.summary ?? null,
      skipReason: null,
      dueAt: outcome === 'success' ? run.dueAt : null,
    }
  }

  /** A skip decided before any run began, for example when the Redis lock could not be asked. */
  skip(definition: ScheduledJobDefinition, reason: 'lock_unavailable'): void {
    const run = new ScheduledRun(randomUUID(), performance.now(), null)
    run.tracked = false
    this.finish(definition, run, { skipped: reason })
  }

  private enqueue(evidence: Evidence): void {
    const lane: Lane = evidence.cadence === 'daily' ? 'event' : 'frequent'
    if (this.flush.degraded && (evidence.kind === 'success' || evidence.kind === 'skip')) {
      this.pending.drop(evidence.jobId, lane)
      return
    }
    this.pending.put(evidence)
    this.flush.kick(lane)
  }

  private admitted(): boolean {
    const pool = this.prisma.poolStats()
    return pool.max >= 2 && pool.waiting === 0 && (pool.idle >= 1 || pool.total < pool.max)
  }

  /**
   * One flush attempt for a lane: the catalogue first, if it is still unreported (an evidence
   * UPDATE finds no row before that), then the lane's snapshot. A failed snapshot goes back to
   * the pending state and the failure is rethrown for the flush control to back off.
   */
  private async writeLane(lane: Lane): Promise<void> {
    await this.ensureRegistered()
    if (!this.pending.has(lane)) return
    const snapshot = this.pending.take(lane)
    try {
      await writeSnapshot(this.prisma, snapshot, [...this.definitions.keys()], {
        adopt: (sample) => this.adopt(sample),
      })
    } catch (error) {
      this.pending.restore(snapshot)
      throw error
    }
  }

  private async ensureRegistered(): Promise<void> {
    const items = this.registration
    if (!items) return
    try {
      await writeRegistration(this.prisma, items)
      if (this.registration === items) this.registration = null
    } catch (error) {
      this.logger.warn(
        { event: 'schedule.registration_failed', error: errorName(error) },
        'Scheduled job registration failed; it is retried while evidence waits'
      )
      throw error
    }
  }

  private adopt(sample: Anchor): Anchor {
    if (!this.anchor || sample.mono - this.anchor.mono > ANCHOR_MAX_AGE_MS) this.anchor = sample
    return this.anchor
  }

  private nextFire(definition: ScheduledJobDefinition): Date | null {
    if (definition.schedule.kind !== 'cron' || !this.scheduler) return null
    try {
      return this.scheduler.getCronJob(definition.id).nextDate().toJSDate()
    } catch {
      return null
    }
  }

  private zoneOf(definition: ScheduledJobDefinition): string | null {
    if (definition.schedule.kind !== 'cron') return null
    return definition.schedule.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  }

  onModuleDestroy(): void {
    this.flush.close()
  }
}
