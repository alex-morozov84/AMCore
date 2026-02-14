import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HttpHealthIndicator,
  MemoryHealthIndicator,
} from '@nestjs/terminus'
import { SkipThrottle } from '@nestjs/throttler'

import { PrismaHealthIndicator } from './indicators/prisma.health'
import { RedisHealthIndicator } from './indicators/redis.health'

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly prisma: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly disk: DiskHealthIndicator,
    private readonly memory: MemoryHealthIndicator
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'General health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prisma.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () =>
        this.disk.checkStorage('disk', {
          // 90% of disk space used is unhealthy
          thresholdPercent: 0.9,
          path: '/',
        }),
      // 300MB heap size is unhealthy
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
    ])
  }

  /**
   * STARTUP PROBE (NEW in 2025!)
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
   *     path: /health/startup
   *     port: 3001
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
   *     path: /health/ready
   *     port: 3001
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
    // Full dependency check - ready for traffic?
    return this.health.check([
      () => this.prisma.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () =>
        this.disk.checkStorage('disk', {
          thresholdPercent: 0.9,
          path: '/',
        }),
      // 1GB heap size threshold (production-ready)
      () => this.memory.checkHeap('memory_heap', 1024 * 1024 * 1024),
    ])
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
   *     path: /health/live
   *     port: 3001
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
}
