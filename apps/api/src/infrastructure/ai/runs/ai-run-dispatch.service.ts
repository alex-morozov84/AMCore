import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { AI_RUN_MAX_DRAIN_CYCLES, AI_RUN_SHUTDOWN_GRACE_MS } from './ai-run.constants'
import { AiRunRepository } from './ai-run.repository'
import { AiRunExecutorService } from './ai-run-executor.service'
import { AI_RUN_CAPACITY_GATE, AI_RUN_SHUTDOWN_LATCH } from './ai-run-shutdown'

import { WorkReadiness } from '@/infrastructure/background-work/work-readiness'
import {
  AttemptRuntime,
  type CapacityGate,
  CUTOFF,
  type ShutdownLatch,
} from '@/infrastructure/worker-lifecycle'
import { PrismaService } from '@/prisma'

/**
 * Drains due AI runs (Track C — ADR-054, ADR-052 pattern, worker role only). Invoked by both the
 * BullMQ wake job (`drainDueBatches`) and the recovery `@Cron` (`runDispatchCycle`); both are safe to
 * run concurrently on every replica because every claim uses `FOR UPDATE SKIP LOCKED` AND they share one
 * process-wide capacity gate.
 *
 * Capacity: a drain reserves "lanes" synchronously before any awaited work; each lane claims ONE run, so
 * a leased run starts immediately (the lease never ages in a batch tail), executes it, and repeats. A
 * lane's reservation is held until the run's physical provider/tool call has SETTLED — a timed-out call
 * whose adapter ignores abort keeps its slot, so detached calls never exceed the cap. This is a
 * per-process limit, not a fleet quota.
 *
 * Shutdown: see `ShutdownLatch`. After the first `shutdown()` nothing new starts, every wait on lane work
 * is bounded by the latch even if a DB promise or provider call never settles, and a run interrupted by
 * the seal is recovered through lease expiry — the seal never writes. The service owns no provider I/O
 * and no state machine: it claims through the repository and hands each claim to the executor.
 */
@Injectable()
export class AiRunDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly activeLanes = new Set<Promise<void>>()
  private shutdownPromise: Promise<void> | undefined
  /** The shutdown grace; a plain field (not a constructor parameter) so tests can shorten it. */
  shutdownGraceMs = AI_RUN_SHUTDOWN_GRACE_MS

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AiRunRepository,
    private readonly executor: AiRunExecutorService,
    @Inject(AI_RUN_SHUTDOWN_LATCH) private readonly latch: ShutdownLatch,
    @Inject(AI_RUN_CAPACITY_GATE) private readonly gate: CapacityGate,
    private readonly logger: PinoLogger,
    private readonly readiness: WorkReadiness
  ) {
    this.logger.setContext(AiRunDispatchService.name)
  }

  /** Register the bounded drain so it completes BEFORE the database pool is torn down. */
  onModuleInit(): void {
    this.prisma.registerShutdownBarrier(() => this.shutdown())
  }

  /** Best-effort earlier stop of new work; the bounded wait is the registered barrier. */
  onModuleDestroy(): void {
    this.latch.close()
  }

  /**
   * Stop new work and wait — boundedly — for lane work. Idempotent: the FIRST call fixes the one deadline
   * (cached promise). The latch is sealed before EVERY return, so a late result can never start
   * fence/admission/DB work after the barrier returned. Never throws.
   */
  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.performShutdown()
    return this.shutdownPromise
  }

  private async performShutdown(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      this.latch.close()
      timer = setTimeout(() => this.latch.seal(), this.shutdownGraceMs)
      await Promise.allSettled([...this.activeLanes])
    } catch {
      this.logger.error({ event: 'ai.run.shutdown_failed' }, 'AI run dispatch shutdown wait failed')
    } finally {
      if (timer) clearTimeout(timer)
      this.latch.seal()
    }
  }

  /** Recovery pass: reclaim crashed leases, sweep overdue queued runs, then drain the backlog. */
  async runDispatchCycle(): Promise<void> {
    if (!this.readiness.isReady || this.latch.closed) return
    await this.reap()
    await this.drainDueBatches()
  }

  /** Reclaim expired leases, expire overdue never-run queued runs and fail runs whose history is full. */
  async reap(): Promise<void> {
    if (!this.readiness.isReady || this.latch.closed) return
    // Each sweep is its own latch-bounded operation: once the dispatcher is closed or sealed no LATER sweep
    // starts (an outer wrapper would release the waiter on seal but let the callback keep issuing queries).
    let rescheduled = 0
    let failed = 0
    let expired = 0
    let capped = 0
    const reaped = await this.latch.run(() => this.repository.reapExpiredLeases())
    if (reaped !== CUTOFF) {
      ;({ rescheduled, failed } = reaped)
      if (!this.latch.closed) {
        await this.diagnoseQueuedRestrictions()
        if (!this.readiness.isReady || this.latch.closed) return
        const overdue = await this.latch.run(() => this.repository.expireDeadlinedRuns())
        if (overdue !== CUTOFF) {
          expired = overdue
          if (!this.latch.closed) {
            const full = await this.latch.run(() => this.repository.failEpochCappedRuns())
            if (full !== CUTOFF) capped = full
          }
        }
      }
    }
    if (rescheduled > 0 || failed > 0 || expired > 0 || capped > 0) {
      this.logger.warn(
        { event: 'ai.run.reaped', rescheduled, failed, expired, capped },
        'Reclaimed expired AI run leases and swept overdue/over-attempted runs'
      )
    }
  }

  /** Diagnosis is an independent capability; failure must not disable healthy main-client recovery. */
  private async diagnoseQueuedRestrictions(): Promise<void> {
    try {
      await this.latch.run(() => this.repository.diagnoseQueuedRestrictions())
    } catch {
      // Do not serialize database errors or reset the diagnosis runner's physical token/quarantine.
      if (!this.latch.closed)
        this.logger.warn(
          { event: 'ai.run.diagnosis_unavailable' },
          'AI queued restriction diagnosis unavailable; ordinary recovery continues'
        )
    }
  }

  /**
   * Reserve lanes, drain due runs (one claim per lane, bounded by a shared run budget) and resolve when
   * lane WORK is done — never waiting for a still-pending physical call.
   */
  async drainDueBatches(): Promise<void> {
    if (!this.readiness.isReady || this.latch.closed) return
    const granted = this.gate.reserve(this.gate.capacity)
    if (granted === 0) {
      // Full: a running lane will look once more before it exits (no lost wake).
      this.gate.requestRescan()
      return
    }
    const budget = { remaining: AI_RUN_MAX_DRAIN_CYCLES * this.gate.capacity }
    await Promise.all(Array.from({ length: granted }, () => this.startLane(budget)))
  }

  private startLane(budget: { remaining: number }): Promise<void> {
    const work = this.runLane(budget)
    this.activeLanes.add(work)
    void work.finally(() => this.activeLanes.delete(work))
    return work
  }

  /** One lane: owns one gate reservation. Never rejects. */
  private async runLane(budget: { remaining: number }): Promise<void> {
    let released = false
    let handedOff = false
    const release = (): void => {
      if (released) return
      released = true
      try {
        this.gate.release(1)
      } catch {
        /* a release failure must never escape a settlement callback */
      }
    }
    try {
      while (this.readiness.isReady && !this.latch.closed && budget.remaining > 0) {
        budget.remaining -= 1
        const claimed = await this.latch.run(() => this.repository.claimDueBatch(1))
        if (claimed === CUTOFF) return
        const claim = claimed[0]
        if (!claim) {
          if (this.gate.consumeRescan()) {
            budget.remaining += 1
            continue
          }
          return
        }

        const runtime = new AttemptRuntime(this.latch.openAttempt())
        try {
          // Bounded by the latch: a seal releases this wait even if a DB promise or provider call never
          // settles (the physical call keeps its slot via the runtime; the run recovers by lease expiry).
          await this.latch.run(() => this.executor.execute(claim, runtime))
        } catch {
          this.logger.error(
            { event: 'ai.run.lane_failed', runId: claim.id },
            'AI run lane failed (the run recovers via lease expiry)'
          )
        }
        if (runtime.transportPending) {
          // The lane is done but the physical call is not: hand the reservation to the settlement
          // tracker (whenSettled consumes resolve AND reject) and end this lane.
          handedOff = true
          void runtime.whenSettled().then(() => {
            runtime.attempt.dispose()
            release()
          })
          return
        }
        runtime.attempt.dispose()
      }
    } catch {
      this.logger.error({ event: 'ai.run.lane_failed' }, 'AI run dispatch lane failed')
    } finally {
      // Not handed off to the settlement tracker (which releases later) → release now.
      if (!handedOff) release()
    }
  }
}
