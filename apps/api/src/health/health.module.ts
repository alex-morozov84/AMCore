import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { PrismaModule } from '../prisma/prisma.module.js'

import { HealthController } from './health.controller.js'
import { PrismaHealthIndicator } from './indicators/prisma.health.js'
import { RedisHealthIndicator } from './indicators/redis.health.js'
import { ReadinessCheckService } from './readiness-check.service.js'

@Module({
  imports: [
    TerminusModule, // Provides HealthCheckService and built-in indicators
    PrismaModule, // For database health checks
  ],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator, // Custom Prisma health indicator
    RedisHealthIndicator, // Custom Redis health indicator
    ReadinessCheckService,
  ],
  // AdminModule reuses the same readiness definition for the console
  // Overview endpoint rather than redefining it.
  exports: [ReadinessCheckService],
})
export class HealthModule {}
