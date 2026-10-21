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
import { type Evidence, type Lane, PendingEvidence } from './scheduled-job-pending.js'
import { register, type Registration } from './scheduled-job-registration.sql.js'
import { writeSnapshot } from './scheduled-job-writer.js'

export class ScheduledRun {
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
 * lost write loses an observation, never a job run.
 */
@Injectable()
export class ScheduledJobRecorder implements OnModuleDestroy {
  private readonly pending = new PendingEvidence()
  private readonly definitions = new Map<string, ScheduledJobDefinition>()
  private readonly flush = new FlushControl({
    hasPending: (lane) => this.pending.has(lane),
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

  /** Registers this process's catalogue once at start. Failure is logged; recording continues without it. */
  async registerJobs(
    definitions: ScheduledJobDefinition[],
    disabled: (definition: ScheduledJobDefinition) => string | null
  ): Promise<void> {
    for (const definition of definitions) this.definitions.set(definition.id, definition)
    const items: Registration[] = definitions.map((definition) => ({
      jobId: definition.id,
      configVersion: configVersionOf(definition),
      scheduleTimeZone: this.zoneOf(definition),
      disabledReason: disabled(definition),
      nextFireAt: this.nextFire(definition),
    }))
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const [clock] = await tx.$queryRaw<{ now: Date }[]>`
            SELECT set_config('statement_timeout', '5000', true),
                   set_config('lock_timeout', '2000', true), clock_timestamp() AS now`
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scheduled_job_run'))`
          await register(tx, items, (clock?.now ?? new Date()).toISOString())
        },
        { maxWait: 2000, timeout: 10_000 }
      )
    } catch (error) {
      this.logger.warn(
        { event: 'schedule.registration_failed', error: errorName(error) },
        'Scheduled job registration failed; evidence is recorded only for jobs already registered'
      )
    }
  }

  begin(definition: ScheduledJobDefinition): ScheduledRun {
    const run = new ScheduledRun(randomUUID(), performance.now(), this.nextFire(definition))
    if (cadenceOf(definition) === 'daily') {
      const maxRuntimeMs = definition.graceMs
      this.pending.startRun({
        jobId: definition.id,
        runId: run.runId,
        startMono: run.startMono,
        maxRuntimeMs,
      })
      this.flush.kick('event')
    }
    return run
  }

  finish(definition: ScheduledJobDefinition, run: ScheduledRun, result: ScheduledJobResult): void {
    const cadence = cadenceOf(definition)
    const endMono = performance.now()
    const durationMs = Math.max(0, Math.round(endMono - run.startMono))
    const base = {
      jobId: definition.id,
      cadence,
      runId: run.runId,
      startMono: run.startMono,
      endMono,
      durationMs,
      configVersion: configVersionOf(definition),
      nextFireAt: this.nextFire(definition),
    }
    if ('skipped' in result) {
      this.enqueue({
        ...base,
        kind: 'skip',
        code: null,
        summary: null,
        skipReason: result.skipped,
        dueAt: null,
      })
      return
    }
    const outcome = result.outcome
    const code = result.code ?? null
    const summary = result.summary ?? null
    this.enqueue({
      ...base,
      kind: outcome === 'failed' ? 'failure' : outcome,
      code,
      summary,
      skipReason: null,
      dueAt: outcome === 'success' ? run.dueAt : null,
    })
    if (cadence === 'daily') {
      this.pending.finishRun({
        jobId: definition.id,
        runId: run.runId,
        outcome,
        endMono,
        durationMs,
        code,
        summary,
      })
      this.flush.kick('event')
    }
  }

  /** A skip decided before any run began, for example when the Redis lock could not be asked. */
  skip(definition: ScheduledJobDefinition, reason: 'lock_unavailable'): void {
    this.finish(definition, new ScheduledRun(randomUUID(), performance.now(), null), {
      skipped: reason,
    })
  }

  private enqueue(evidence: Evidence): void {
    if (this.flush.degraded && (evidence.kind === 'success' || evidence.kind === 'skip')) {
      this.pending.drop(evidence.jobId, evidence.cadence === 'daily' ? 'event' : 'frequent')
      return
    }
    this.pending.put(evidence)
    this.flush.kick(evidence.cadence === 'daily' ? 'event' : 'frequent')
  }

  private admitted(): boolean {
    const pool = this.prisma.poolStats()
    return pool.max >= 2 && pool.waiting === 0 && (pool.idle >= 1 || pool.total < pool.max)
  }

  /** Takes one lane's snapshot and writes it; on failure the snapshot goes back for the next try. */
  private async writeLane(lane: Lane): Promise<void> {
    const snapshot = this.pending.take(lane)
    try {
      await writeSnapshot(this.prisma, snapshot, [...this.definitions.keys()])
    } catch (error) {
      this.pending.restore(snapshot)
      throw error
    }
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
