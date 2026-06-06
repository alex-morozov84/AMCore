import { Injectable } from '@nestjs/common'

import { PrismaService } from './prisma.service'

import { METRIC_NAMES, MetricsService } from '@/infrastructure/observability'

@Injectable()
export class DbPoolMetricsCollector {
  constructor(metrics: MetricsService, prisma: PrismaService) {
    metrics.registerGauge<'state'>({
      name: METRIC_NAMES.dbPoolConnections,
      help: 'PostgreSQL pool connections by state.',
      labelNames: ['state'],
      collect: (gauge) => {
        const pool = prisma.getPoolStats()
        gauge.reset()
        gauge.set({ state: 'total' }, pool.total)
        gauge.set({ state: 'idle' }, pool.idle)
        gauge.set({ state: 'waiting' }, pool.waiting)
      },
    })
  }
}
