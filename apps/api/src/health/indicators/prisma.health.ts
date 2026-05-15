import { Injectable } from '@nestjs/common'
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'

import { EnvService } from '@/env/env.service'
import { PrismaService } from '@/prisma/prisma.service'

@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly env: EnvService
  ) {}

  // Reports current DB connectivity + pool snapshot. Returns `down()` when the
  // pool waiting queue is over `DATABASE_POOL_WAITING_THRESHOLD`. Hysteresis
  // (how long the pool must stay saturated before K8s pulls the pod) is the
  // job of the Kubernetes readinessProbe `failureThreshold` / `periodSeconds`
  // pair, not this indicator. See ADR-031.
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key)

    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Database connection failed'
      return indicator.down({ message })
    }

    const pool = this.prisma.getPoolStats()
    const threshold = this.env.get('DATABASE_POOL_WAITING_THRESHOLD')

    if (pool.waiting > threshold) {
      return indicator.down({
        pool,
        message: `pool saturated: ${pool.waiting} waiting (threshold ${threshold})`,
      })
    }

    return indicator.up({ pool })
  }
}
