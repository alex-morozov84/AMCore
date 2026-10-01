import { randomUUID } from 'node:crypto'

import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { type AdminOverviewStorage } from '@amcore/shared'

import { StorageProbeIo } from './storage-probe.io'

import { EnvService } from '@/env/env.service'
import { MetricsService } from '@/infrastructure/observability'
import { METRIC_NAMES } from '@/infrastructure/observability/metrics.constants'

export type StorageProbeSnapshot = AdminOverviewStorage
export type StorageProbeFailure = NonNullable<AdminOverviewStorage['failure']>

/** Per-instance observation, independent of readiness and dashboard traffic. */
@Injectable()
export class StorageProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly key = `${randomUUID()}.bin`
  private timer?: NodeJS.Timeout
  private active?: Promise<void>
  private stopped = false
  private nextScheduledAt: number | null = null
  private result: Pick<StorageProbeSnapshot, 'checkedAt' | 'failure' | 'stage'> = {
    checkedAt: null,
    failure: null,
    stage: null,
  }

  constructor(
    private readonly env: EnvService,
    private readonly io: StorageProbeIo,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger
  ) {}

  onModuleInit(): void {
    this.metrics.registerGauge({
      name: METRIC_NAMES.storageProbeState,
      help: 'Cached per-instance synthetic file transaction state; exactly one state is 1.',
      labelNames: ['driver', 'state'],
      collect: (gauge) => {
        const snapshot = this.snapshot()
        for (const state of ['healthy', 'failed', 'unknown', 'stale']) {
          gauge.set({ driver: snapshot.driver, state }, Number(snapshot.state === state))
        }
      },
    })
    this.nextScheduledAt = Date.now() + this.intervalMs()
    void this.run()
    this.timer = setInterval(() => {
      this.nextScheduledAt = Date.now() + this.intervalMs()
      void this.run()
    }, this.intervalMs())
    this.timer.unref()
  }

  onModuleDestroy(): void {
    this.stopped = true
    clearInterval(this.timer)
    this.io.destroy()
  }

  snapshot(): StorageProbeSnapshot {
    const staleAfterSeconds = this.env.get('STORAGE_PROBE_INTERVAL_SECONDS') * 3
    const age = this.result.checkedAt ? Date.now() - Date.parse(this.result.checkedAt) : 0
    const state = !this.result.checkedAt
      ? 'unknown'
      : age > staleAfterSeconds * 1000
        ? 'stale'
        : this.result.failure
          ? 'failed'
          : 'healthy'
    return {
      ...this.result,
      state,
      inProgress: Boolean(this.active),
      nextScheduledAt:
        !this.active && !this.stopped && this.nextScheduledAt !== null
          ? new Date(this.nextScheduledAt).toISOString()
          : null,
      driver: this.env.get('STORAGE_DRIVER'),
      intervalSeconds: this.intervalMs() / 1000,
      staleAfterSeconds,
    }
  }

  /** No overlap, even if filesystem cancellation has not settled after deadline. */
  run(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.active) return this.active
    this.active = this.transaction().finally(() => {
      this.active = undefined
    })
    return this.active
  }

  private async transaction(): Promise<void> {
    let stage: NonNullable<StorageProbeSnapshot['stage']> = 'write'
    let failure: StorageProbeFailure | null = null
    let failureStage: StorageProbeSnapshot['stage'] = null
    const controller = new AbortController()
    const deadline = setTimeout(
      () => {
        failure = 'timeout'
        failureStage = stage
        this.publish(failure, stage)
        controller.abort()
      },
      this.env.get('STORAGE_PROBE_TIMEOUT_SECONDS') * 1000
    )
    const bytes = Buffer.from('AMCore isolated storage diagnostic\n')
    try {
      await this.io.write(this.key, bytes, controller.signal)
      stage = 'read'
      const read = await this.io.read(this.key, controller.signal)
      if (!bytes.equals(read)) {
        failure = 'content_mismatch'
        failureStage = stage
      }
    } catch (error) {
      failure ??= classifyFailure(error)
      failureStage ??= stage
    } finally {
      clearTimeout(deadline)
      stage = 'delete'
      const cleanup = new AbortController()
      const timer = setTimeout(() => {
        failure ??= 'timeout'
        failureStage ??= stage
        this.publish(failure, failureStage)
        cleanup.abort()
      }, 5000)
      try {
        await this.io.remove(this.key, cleanup.signal)
      } catch (error) {
        if (!failure) {
          failure = classifyFailure(error)
          failureStage = 'delete'
        }
      } finally {
        clearTimeout(timer)
      }
      this.publish(failure, failureStage)
    }
  }

  private publish(failure: StorageProbeFailure | null, stage: StorageProbeSnapshot['stage']): void {
    if (failure && (this.result.failure !== failure || this.result.stage !== stage)) {
      this.logger.warn({
        event: 'storage_probe_failed',
        driver: this.env.get('STORAGE_DRIVER'),
        failure,
        stage,
      })
    }
    this.result = { checkedAt: new Date().toISOString(), failure, stage: failure ? stage : null }
  }

  private intervalMs(): number {
    return this.env.get('STORAGE_PROBE_INTERVAL_SECONDS') * 1000
  }
}

function classifyFailure(error: unknown): StorageProbeFailure {
  const e = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.code === 'EACCES' ||
    e?.code === 'EPERM' ||
    e?.name === 'AccessDenied' ||
    e?.$metadata?.httpStatusCode === 403
    ? 'access_denied'
    : 'io_error'
}
