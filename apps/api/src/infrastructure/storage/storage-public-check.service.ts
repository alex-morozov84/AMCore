import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../../env/env.service.js'
import { MetricsService } from '../observability/index.js'
import { METRIC_NAMES } from '../observability/metrics.constants.js'

import {
  canaryKeys,
  checkPublicDelivery,
  ensureCanaries,
  type PublicCheckFailure,
  type PublicCheckResult,
  type PublicCheckStage,
  type PublicDeliveryDeps,
} from './public-delivery-check.js'
import { STORAGE_PROVIDER } from './storage.constants.js'
import type { StorageProvider } from './storage.interface.js'
import { ANONYMOUS_READ, type AnonymousRead } from './storage-anonymous-read.js'

export type PublicCheckState = 'healthy' | 'failed' | 'unknown' | 'stale' | 'off'
export type PublicCheckOffReason = 'local_driver' | 'memory_driver' | 'disabled' | 'worker_process'
export type PublicDeliveryMode = 'external' | 'acl' | 'api'

/**
 * What the Console shows about public files: the configuration that matters to an operator
 * (never a bucket name, endpoint or credential) and the last result of this API instance.
 */
export interface PublicCheckSnapshot {
  driver: string
  state: PublicCheckState
  /** `null` while the check runs; otherwise why this instance does not run it. */
  offReason: PublicCheckOffReason | null
  delivery: PublicDeliveryMode
  /** `one` bucket (a published prefix) or `two` buckets (private and public). */
  layout: 'one' | 'two'
  publicBaseUrl: string | null
  checkedAt: string | null
  stage: PublicCheckStage | null
  failure: PublicCheckFailure | null
}

/**
 * Per-instance observation of the public boundary, independent of readiness and of user
 * traffic. After one idempotent canary write at boot it only reads: the public canary must
 * be served anonymously, and the private canary must be refused through the storage API
 * (and through the public base when one bucket holds both namespaces). It never changes
 * readiness; a failure is a metric, a log line and an operator command away from a fix.
 */
@Injectable()
export class StoragePublicCheckService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout
  private active?: Promise<void>
  private stopped = false
  private result: Pick<PublicCheckSnapshot, 'checkedAt' | 'stage' | 'failure'> = {
    checkedAt: null,
    stage: null,
    failure: null,
  }

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
    private readonly env: EnvService,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    @Inject(ANONYMOUS_READ) private readonly read: AnonymousRead
  ) {}

  /**
   * Only the s3 driver has a public bucket to verify; local and memory never run it. The
   * check observes the deployment's buckets and base URL, not per-process credentials, so
   * a dedicated worker skips it instead of duplicating requests and exposure alerts.
   */
  get enabled(): boolean {
    return this.offReason() === null
  }

  /** Why this process does not run the check, or `null` when it does. */
  private offReason(): PublicCheckOffReason | null {
    const driver = this.env.get('STORAGE_DRIVER')
    if (driver === 'local') return 'local_driver'
    if (driver !== 's3') return 'memory_driver'
    if (!this.env.get('STORAGE_PUBLIC_CHECK_ENABLED')) return 'disabled'
    return this.env.get('PROCESS_ROLE') === 'worker' ? 'worker_process' : null
  }

  onModuleInit(): void {
    // Registered even when the check is off, so the series exist (state "off") on every process.
    this.registerMetrics()
    if (this.enabled) void this.boot()
  }

  onModuleDestroy(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
  }

  snapshot(): PublicCheckSnapshot {
    const driver = this.env.get('STORAGE_DRIVER')
    const { checkedAt, stage, failure } = this.result
    const staleAfterMs = this.env.get('STORAGE_PUBLIC_CHECK_INTERVAL_SECONDS') * 3 * 1000
    const stale = checkedAt !== null && Date.now() - Date.parse(checkedAt) > staleAfterMs
    const offReason = this.offReason()
    const state: PublicCheckState = offReason
      ? 'off'
      : checkedAt === null
        ? 'unknown'
        : failure
          ? 'failed'
          : stale
            ? 'stale'
            : 'healthy'
    return {
      driver,
      state,
      offReason,
      delivery: this.env.get('STORAGE_PUBLIC_DELIVERY'),
      layout: this.singleBucket() ? 'one' : 'two',
      publicBaseUrl: this.env.get('STORAGE_PUBLIC_BASE_URL') ?? null,
      checkedAt: offReason ? null : checkedAt,
      stage: offReason ? null : stage,
      failure: offReason ? null : failure,
    }
  }

  private singleBucket(): boolean {
    const publicBucket = this.env.get('STORAGE_PUBLIC_BUCKET')
    return !publicBucket || publicBucket === this.env.get('STORAGE_BUCKET')
  }

  /** Write the canaries, check once, then schedule the read-only checks. */
  async boot(): Promise<void> {
    try {
      await ensureCanaries(this.deps())
    } catch (error) {
      this.publish({ ok: false, stage: 'setup', failure: 'check_error' }, error)
    }
    await this.run()
    if (this.stopped) return
    const everyMs = this.env.get('STORAGE_PUBLIC_CHECK_INTERVAL_SECONDS') * 1000
    this.timer = setInterval(() => void this.run(), everyMs)
    this.timer.unref()
  }

  /** One read-only check; an unfinished check keeps the slot, so runs never overlap. */
  run(): Promise<void> {
    this.active ??= this.execute().finally(() => {
      this.active = undefined
    })
    return this.active
  }

  private async execute(): Promise<void> {
    const timeoutMs = this.env.get('STORAGE_PUBLIC_CHECK_TIMEOUT_SECONDS') * 1000
    await this.restorePrivateCanary()
    let result = await this.once(timeoutMs)
    if (!result.ok && result.stage === 'public_read' && result.status === 404) {
      // A missing canary (bucket emptied, lifecycle rule, first instance racing the write):
      // repair it and judge again before reporting anything.
      try {
        await ensureCanaries(this.deps())
        result = await this.once(timeoutMs)
      } catch {
        // the original result stands
      }
    }
    this.publish(result)
  }

  /**
   * An anonymous 404 counts as "refused", so a private canary removed by a lifecycle rule
   * would hide an exposed bucket. One authenticated HEAD per run restores it first.
   */
  private async restorePrivateCanary(): Promise<void> {
    try {
      const { privateKey } = canaryKeys(this.env.get('STORAGE_PROBE_PREFIX'))
      if (!(await this.provider.exists(privateKey))) await ensureCanaries(this.deps())
    } catch {
      // The check itself reports an unreachable or misconfigured store.
    }
  }

  private async once(timeoutMs: number): Promise<PublicCheckResult> {
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      return await checkPublicDelivery(this.deps(), signal)
    } catch {
      return {
        ok: false,
        stage: 'public_read',
        failure: signal.aborted ? 'timeout' : 'check_error',
      }
    }
  }

  private deps(): PublicDeliveryDeps {
    return {
      storage: this.provider,
      read: this.read,
      publicBaseUrl: this.env.get('STORAGE_PUBLIC_BASE_URL') as string,
      urlForm: this.env.get('STORAGE_PUBLIC_DELIVERY') === 'api' ? 'route' : 'bucket-root',
      singleBucket: this.singleBucket(),
      probePrefix: this.env.get('STORAGE_PROBE_PREFIX'),
    }
  }

  /** Log only on a change, so an hourly check cannot flood the log. */
  private publish(result: PublicCheckResult, error?: unknown): void {
    const next = result.ok
      ? { stage: null, failure: null }
      : { stage: result.stage, failure: result.failure }
    if (
      next.failure &&
      (this.result.failure !== next.failure || this.result.stage !== next.stage)
    ) {
      this.logger.warn({
        event: 'storage_public_check_failed',
        driver: this.env.get('STORAGE_DRIVER'),
        stage: next.stage,
        failure: next.failure,
        ...(result.ok ? {} : { status: result.status }),
        ...(error ? { err: error } : {}),
      })
    } else if (!next.failure && this.result.failure) {
      this.logger.info({
        event: 'storage_public_check_recovered',
        driver: this.env.get('STORAGE_DRIVER'),
      })
    }
    this.result = { checkedAt: new Date().toISOString(), ...next }
  }

  private registerMetrics(): void {
    this.metrics.registerGauge({
      name: METRIC_NAMES.storagePublicCheckState,
      help: 'Cached per-instance public-delivery check state; exactly one state is 1.',
      labelNames: ['driver', 'state'],
      collect: (gauge) => {
        const snapshot = this.snapshot()
        for (const state of ['healthy', 'failed', 'unknown', 'stale', 'off']) {
          gauge.set({ driver: snapshot.driver, state }, Number(snapshot.state === state))
        }
      },
    })
    this.metrics.registerGauge({
      name: METRIC_NAMES.storagePrivateExposed,
      help: '1 when the last check reached the private canary without credentials.',
      labelNames: ['driver'],
      collect: (gauge) => {
        const snapshot = this.snapshot()
        gauge.set({ driver: snapshot.driver }, Number(snapshot.failure === 'private_exposed'))
      },
    })
  }
}
