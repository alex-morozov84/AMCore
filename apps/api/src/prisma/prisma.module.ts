import { Global, Module } from '@nestjs/common'

import { ObservabilityModule } from '../infrastructure/observability/index.js'

import { DbPoolMetricsCollector } from './db-pool-metrics.collector.js'
import { PrismaService } from './prisma.service.js'

@Global()
@Module({
  imports: [ObservabilityModule],
  providers: [PrismaService, DbPoolMetricsCollector],
  exports: [PrismaService],
})
export class PrismaModule {}
