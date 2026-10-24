import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'

import { EnvService } from '../../../../env/env.service.js'
import { MetricsService } from '../../../../infrastructure/observability/index.js'
import { METRIC_NAMES } from '../../../../infrastructure/observability/metrics.constants.js'
import { ScheduledJobExecutor } from '../../../../infrastructure/schedule/scheduled-job.executor.js'
import {
  failed,
  ScheduledJob,
  type ScheduledJobResult,
  skippedFor,
  succeeded,
} from '../../../../infrastructure/schedule/scheduled-job.js'
import { TELEGRAM_REACHABILITY_JOB } from '../../../../infrastructure/schedule/scheduled-jobs.catalogue.js'

import { telegramCheckBinding } from './telegram-reachability.binding.js'
import { checkTelegram } from './telegram-reachability.check.js'
import { TELEGRAM_REACHABILITY, type TelegramCheckOutcome } from './telegram-reachability.policy.js'
import {
  TelegramReachabilityStore,
  type TelegramWriteOutcome,
} from './telegram-reachability.store.js'

const METRIC_STATES = ['ok', 'failed', 'unknown', 'stale', 'none'] as const

const WRITE_RESULT: Record<Exclude<TelegramWriteOutcome, 'stored'>, string> = {
  late: 'store_late',
  overflow: 'store_overflow',
  unavailable: 'store_unavailable',
}

/**
 * Worker/all only: every minute each worker asks Telegram `getMe` through the same base URL the
 * delivery uses, keeps its own classification for the metric and stores it for the Console. The
 * job's work is "observe and store": a stored failure is a successful run; only a lost store is a
 * failed run. Telegram outages are read on the Integrations page, not on Scheduled jobs.
 */
@Injectable()
export class TelegramReachabilityService implements OnModuleInit, OnModuleDestroy {
  private readonly instanceId = randomUUID()
  private readonly shutdown = new AbortController()
  private seq = 0
  private active?: Promise<ScheduledJobResult>
  private lastWriteAt?: number
  private last?: { outcome: TelegramCheckOutcome; at: number }

  constructor(
    private readonly env: EnvService,
    private readonly store: TelegramReachabilityStore,
    private readonly metrics: MetricsService,
    private readonly jobs: ScheduledJobExecutor
  ) {}

  private get token(): string | undefined {
    return this.env.get('TELEGRAM_BOT_TOKEN') || undefined
  }

  onModuleInit(): void {
    if (!this.token) return
    this.metrics.registerGauge({
      name: METRIC_NAMES.telegramReachabilityState,
      help: 'Last Telegram getMe result of this worker; exactly one state is 1.',
      labelNames: ['state'],
      collect: (gauge) => {
        const current = this.metricState()
        for (const state of METRIC_STATES) gauge.set({ state }, Number(current === state))
      },
    })
  }

  @ScheduledJob(TELEGRAM_REACHABILITY_JOB)
  async scheduledCheck(): Promise<void> {
    if (!this.token) return
    await this.jobs.run(TELEGRAM_REACHABILITY_JOB, () => this.runOnce())
  }

  /** One check at a time per worker; a second tick while one is open is `busy`. */
  runOnce(): Promise<ScheduledJobResult> {
    if (this.shutdown.signal.aborted) return Promise.resolve(skippedFor('shutdown'))
    if (this.active) return Promise.resolve(skippedFor('busy'))
    this.active = this.observe().finally(() => {
      this.active = undefined
    })
    return this.active
  }

  private async observe(): Promise<ScheduledJobResult> {
    const token = this.token
    if (!token) return skippedFor('not_ready')
    const baseUrl = this.env.get('TELEGRAM_API_BASE_URL')
    this.store.open()
    // The observation time comes from Redis before the request, never from when the write runs.
    const redisStart = await this.store.now()
    const startedAt = performance.now()
    const outcome = await checkTelegram({ baseUrl, token, shutdown: this.shutdown.signal })
    if (outcome === 'shutdown') return skippedFor('shutdown')
    this.last = { outcome, at: performance.now() }
    if (redisStart === undefined) return failed('store_unavailable')
    if (this.shutdown.signal.aborted) return skippedFor('shutdown')
    this.lastWriteAt = performance.now()
    const written = await this.store.write(this.instanceId, {
      v: 1,
      binding: telegramCheckBinding(token, baseUrl),
      observedAt: Math.round(redisStart + (performance.now() - startedAt)),
      seq: ++this.seq,
      result: outcome.result,
      failure: outcome.failure,
    })
    if (written !== 'stored') return failed(WRITE_RESULT[written])
    return succeeded({ counts: {}, codes: outcome.failure ? [outcome.failure] : [] })
  }

  /** `none` before the first result; `stale` when this worker's checker stopped updating. */
  metricState(): (typeof METRIC_STATES)[number] {
    if (!this.last) return 'none'
    const age = performance.now() - this.last.at
    return age > TELEGRAM_REACHABILITY.staleAfterSeconds * 1000 ? 'stale' : this.last.outcome.result
  }

  /**
   * Graceful stop: no new checks, abort the open one, let a sent write settle, wait out the
   * window in which a late write could still be accepted, then remove this worker's result.
   * A crash skips all of this: the result then ages into stale and expires after retention.
   */
  async onModuleDestroy(): Promise<void> {
    this.shutdown.abort()
    await this.active?.catch(() => undefined)
    if (this.seq > 0 && this.lastWriteAt !== undefined) {
      const fence =
        this.lastWriteAt + TELEGRAM_REACHABILITY.maxWriteDelayMs + 100 - performance.now()
      if (fence > 0) await new Promise((resolve) => setTimeout(resolve, fence))
      await this.store.remove(this.instanceId)
    }
    await this.store.close()
  }
}
