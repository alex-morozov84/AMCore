import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { HealthController } from './health.controller'
import { PrismaHealthIndicator } from './indicators/prisma.health'
import { RedisHealthIndicator } from './indicators/redis.health'

import { PrismaModule } from '@/prisma/prisma.module'

@Module({
  imports: [
    TerminusModule, // Provides HealthCheckService and built-in indicators
    HttpModule, // Required for HttpHealthIndicator
    PrismaModule, // For database health checks
  ],
  controllers: [HealthController],
  providers: [
    PrismaHealthIndicator, // Custom Prisma health indicator
    RedisHealthIndicator, // Custom Redis health indicator
  ],
})
export class HealthModule {}
