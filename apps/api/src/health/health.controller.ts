import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  type HealthIndicatorFunction,
  MemoryHealthIndicator,
} from '@nestjs/terminus'
import { SkipThrottle } from '@nestjs/throttler'

import { AuthType } from '@amcore/shared'

import { PrismaHealthIndicator } from './indicators/prisma.health'
import { RedisHealthIndicator } from './indicators/redis.health'

import { Auth } from '@/core/auth/decorators/auth.decorator'

@ApiTags('health')
@Controller('health')
@Auth(AuthType.None)
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly memory: MemoryHealthIndicator
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'General health summary (alias of readiness)' })
  @ApiResponse({ status: 200, description: 'Service is healthy and ready to accept traffic' })
  @ApiResponse({ status: 503, description: 'Service is not ready to accept traffic' })
  check(): Promise<HealthCheckResult> {
    return this.health.check(this.getReadinessChecks())
  }

  /**
   * STARTUP PROBE
   *
   * Used by Kubernetes to detect when the application has successfully started.
   * Until this succeeds, liveness probe is disabled.
   *
   * Checks: Database + Redis connectivity
   *
   * K8s config:
   * ```yaml
   * startupProbe:
   *   httpGet:
   *     path: /api/v1/health/startup
   *     port: 5002
   *   failureThreshold: 30      # 30 attempts
   *   periodSeconds: 10         # every 10 seconds
   *   # Max 300 seconds (5 minutes) to start
   * ```
   */
  @Get('startup')
  @HealthCheck()
  @ApiOperation({ summary: 'Startup probe (Kubernetes startupProbe)' })
  @ApiResponse({ status: 200, description: 'Application started successfully' })
  @ApiResponse({ status: 503, description: 'Application not ready yet' })
  startup(): Promise<HealthCheckResult> {
    // Critical dependencies that must be available before app starts
    return this.health.check([
      () => this.prisma.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
    ])
  }

  /**
   * READINESS PROBE
   *
   * Used by Kubernetes to detect if the application is ready to receive traffic.
   * If this fails, the pod is removed from the Service load balancer.
   *
   * Checks: Database, Redis, Disk, Memory
   *
   * K8s config:
   * ```yaml
   * readinessProbe:
   *   httpGet:
   *     path: /api/v1/health/ready
   *     port: 5002
   *   initialDelaySeconds: 5
   *   periodSeconds: 5
   *   timeoutSeconds: 10        # Longer timeout for DB checks
   * ```
   */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (Kubernetes readinessProbe)' })
  @ApiResponse({ status: 200, description: 'Service is ready to accept traffic' })
  @ApiResponse({ status: 503, description: 'Service is not ready' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check(this.getReadinessChecks())
  }

  /**
   * LIVENESS PROBE
   *
   * Used by Kubernetes to detect if the container is alive.
   * If this fails, Kubernetes will restart the container.
   *
   * IMPORTANT: Keep this FAST and SIMPLE (< 1 second)
   * Don't check external dependencies - they can be temporarily unavailable.
   *
   * K8s config:
   * ```yaml
   * livenessProbe:
   *   httpGet:
   *     path: /api/v1/health/live
   *     port: 5002
   *   initialDelaySeconds: 0    # startupProbe protects this
   *   periodSeconds: 10
   *   timeoutSeconds: 1         # Fast timeout
   * ```
   */
  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe (Kubernetes livenessProbe)' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  @ApiResponse({ status: 503, description: 'Service should be restarted' })
  live(): Promise<HealthCheckResult> {
    // Simple check: process is running
    // No external dependencies - keep it FAST!
    return this.health.check([
      // Just check memory isn't completely exhausted
      () => this.memory.checkHeap('memory_heap', 1536 * 1024 * 1024), // 1.5GB (high threshold)
    ])
  }

  private getReadinessChecks(): HealthIndicatorFunction[] {
    return [
      () => this.prisma.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () =>
        this.disk.checkStorage('disk', {
          thresholdPercent: 0.9,
          path: '/',
        }),
      () => this.memory.checkHeap('memory_heap', 1024 * 1024 * 1024),
    ]
  }
}
