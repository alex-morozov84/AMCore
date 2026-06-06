import { Global, Module } from '@nestjs/common'

import { DbPoolMetricsCollector } from './db-pool-metrics.collector'
import { PrismaService } from './prisma.service'

import { ObservabilityModule } from '@/infrastructure/observability'

@Global()
@Module({
  imports: [ObservabilityModule],
  providers: [PrismaService, DbPoolMetricsCollector],
  exports: [PrismaService],
})
export class PrismaModule {}
