import { Injectable } from '@nestjs/common'
import {
  DiskHealthIndicator,
  type HealthCheckResult,
  HealthCheckService,
  type HealthIndicatorFunction,
  MemoryHealthIndicator,
} from '@nestjs/terminus'

import { PrismaHealthIndicator } from './indicators/prisma.health'
import { RedisHealthIndicator } from './indicators/redis.health'

import { EnvService } from '@/env/env.service'
import { StorageHealthIndicator } from '@/infrastructure/storage'

/**
 * The readiness check set (ADR-031's DB-pool/disk/memory checks), shared by
 * the public `/health` readiness probes and the admin Overview endpoint so
 * they can never drift apart into two different definitions of "ready".
 */
@Injectable()
export class ReadinessCheckService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly storage: StorageHealthIndicator,
    private readonly env: EnvService
  ) {}

  /** Throws `ServiceUnavailableException(result)` when any check reports `down`. */
  check(): Promise<HealthCheckResult> {
    return this.health.check(this.getChecks())
  }

  private getChecks(): HealthIndicatorFunction[] {
    const checks: HealthIndicatorFunction[] = [
      () => this.prisma.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () =>
        this.disk.checkStorage('disk', {
          thresholdPercent: this.env.get('HEALTH_DISK_THRESHOLD_PERCENT'),
          path: '/',
        }),
      () =>
        this.memory.checkHeap(
          'memory_heap',
          this.env.get('HEALTH_MEMORY_HEAP_BYTES') ?? 1024 * 1024 * 1024
        ),
    ]

    // Opt-in (Decision B): storage is not on the core request hot path, so it
    // joins readiness only when explicitly enabled.
    if (this.env.get('STORAGE_HEALTH_ENABLED')) {
      checks.push(() => this.storage.isHealthy('storage'))
    }

    return checks
  }
}
