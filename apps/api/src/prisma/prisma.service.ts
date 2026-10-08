import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PinoLogger } from 'nestjs-pino'
import { Pool } from 'pg'

import type { Env } from '../env'
import { EnvService } from '../env/env.service'
import { MetricsService } from '../infrastructure/observability'

import { ObservedTransactionRunner } from './observed-transaction'

import { PrismaClient } from '@/generated/prisma/client'

type SlowQueryEvent = {
  query: string
  duration: number
  params?: string
}

export function resolveSlowQueryThresholdMs(
  nodeEnv: Env['NODE_ENV'],
  configuredThresholdMs: number
): number {
  return configuredThresholdMs ?? (nodeEnv === 'production' ? 500 : 100)
}

export function logSlowQuery(
  event: SlowQueryEvent,
  thresholdMs: number,
  logger: Pick<PinoLogger, 'warn'>
): void {
  if (event.duration <= thresholdMs) {
    return
  }

  logger.warn(
    {
      query: event.query,
      duration: event.duration,
    },
    'slow query'
  )
}

export function handleSlowQuery(
  event: SlowQueryEvent,
  thresholdMs: number,
  logger: Pick<PinoLogger, 'warn'>,
  metrics: Pick<MetricsService, 'incDbSlowQuery'>
): void {
  if (event.duration > thresholdMs) {
    metrics.incDbSlowQuery()
  }
  logSlowQuery(event, thresholdMs, logger)
}

/**
 * Safety cap on all shutdown barriers combined (see `registerShutdownBarrier`). Deliberately
 * above the notification dispatcher's own grace; it bounds the wait, it does not cancel work.
 */
export const SHUTDOWN_BARRIER_MAX_MS = 20 * 1000

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: Pool
  private readonly shutdownBarriers: Array<() => Promise<void>> = []
  private tearingDown = false
  private readonly observedRunners = new Map<
    'ai-catalogue' | 'ai-diagnosis',
    ObservedTransactionRunner
  >()

  constructor(
    env: EnvService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService
  ) {
    const pool = new Pool({
      connectionString: env.get('DATABASE_URL'),
      max: env.get('DATABASE_POOL_MAX'),
      idleTimeoutMillis: env.get('DATABASE_POOL_IDLE_MS'),
      connectionTimeoutMillis: env.get('DATABASE_CONNECT_MS'),
      statement_timeout: env.get('DATABASE_STATEMENT_TIMEOUT_MS'),
      query_timeout: env.get('DATABASE_QUERY_TIMEOUT_MS'),
      // Role-specific (ADR-029 intent, extended for ADR-041): pg-side pool
      // pressure is visible per role — `amcore-web` / `amcore-worker` / `amcore-all`.
      application_name: `amcore-${env.get('PROCESS_ROLE')}`,
    })
    const adapter = new PrismaPg(pool)
    const slowQueryThresholdMs = resolveSlowQueryThresholdMs(
      env.get('NODE_ENV'),
      env.get('SLOW_QUERY_THRESHOLD_MS')
    )

    super({
      adapter,
      log: [{ emit: 'event', level: 'query' }],
    })

    this.pool = pool
    this.logger.setContext(PrismaService.name)
    // $on must be invoked with `this` bound to the PrismaClient instance — a
    // detached reference (`const f = this.$on; f(...)`) loses binding and Prisma
    // throws "Cannot read properties of undefined (reading '_engineConfig')".
    const subscribeToQueries = this.$on as (
      eventType: 'query',
      listener: (event: SlowQueryEvent) => void
    ) => void
    subscribeToQueries.call(this, 'query', (event) => {
      handleSlowQuery(event, slowQueryThresholdMs, this.logger, this.metrics)
    })
  }

  /** Two named capabilities share this pool; an uncertain token cannot be reset by its consumer. */
  observedTransactions(name: 'ai-catalogue' | 'ai-diagnosis'): ObservedTransactionRunner {
    if (this.tearingDown) throw new Error('prisma_shutdown_registration_closed')
    let runner = this.observedRunners.get(name)
    if (!runner) {
      runner = new ObservedTransactionRunner(this.pool, () =>
        this.logger.warn(
          { event: 'prisma.observed_transaction_quarantined', consumer: name },
          'Physical transaction completion is unknown; restart is required to restore this capability'
        )
      )
      this.observedRunners.set(name, runner)
    }
    return runner
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  /**
   * Register a drain that must finish BEFORE the database is torn down (a worker that has to
   * record in-flight results, for example). Barriers run at the start of `onModuleDestroy`, so
   * ordering never depends on module distance or provider declaration order — Nest runs all
   * destroy hooks before `beforeApplicationShutdown`, and hooks of one module concurrently.
   *
   * A barrier must bound ITSELF below `SHUTDOWN_BARRIER_MAX_MS`; the cap is only a safety net so a
   * misbehaving barrier cannot skip database cleanup, and it does not cancel the barrier.
   * Registration is rejected once teardown has started.
   */
  registerShutdownBarrier(barrier: () => Promise<void>): void {
    if (this.tearingDown) {
      throw new Error('prisma_shutdown_barrier_registration_closed')
    }
    this.shutdownBarriers.push(barrier)
  }

  async onModuleDestroy(): Promise<void> {
    this.tearingDown = true
    for (const runner of this.observedRunners.values()) runner.close()
    try {
      await this.runShutdownBarriers()
    } finally {
      await this.disconnectObservedRunners()
      // Always attempt BOTH, even when a barrier or the disconnect rejects.
      try {
        await this.$disconnect()
      } finally {
        await this.pool.end()
      }
    }
  }

  private async disconnectObservedRunners(): Promise<void> {
    if (!this.observedRunners.size) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 2000)
    })
    try {
      const cleanup = Promise.allSettled(
        [...this.observedRunners.values()].map((runner) => runner.disconnect())
      )
      await Promise.race([cleanup, deadline])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async runShutdownBarriers(): Promise<void> {
    if (this.shutdownBarriers.length === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const cap = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(
        () => resolve('timeout'),
        SHUTDOWN_BARRIER_MAX_MS - (this.observedRunners.size ? 2000 : 0)
      )
    })
    try {
      const settled = Promise.allSettled(
        this.shutdownBarriers.map((barrier) => (async () => barrier())())
      )
      const result = await Promise.race([settled, cap])
      if (result === 'timeout') {
        this.logger.warn(
          { event: 'prisma.shutdown_barrier_timeout' },
          'A shutdown barrier exceeded its cap; continuing with database teardown'
        )
        return
      }
      for (const outcome of result) {
        if (outcome.status === 'rejected') {
          this.logger.error(
            { event: 'prisma.shutdown_barrier_failed' },
            'A shutdown barrier failed; continuing with database teardown'
          )
        }
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  // Pool stats for readiness probes / observability. Encapsulated so the
  // underlying pg.Pool stays private. See `health/indicators/prisma.health.ts`
  // for the consumer; defaults and tuning are documented in ADR-029.
  getPoolStats(): { total: number; idle: number; waiting: number } {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    }
  }
}
