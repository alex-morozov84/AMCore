import { DbPoolMetricsCollector } from './db-pool-metrics.collector'
import { PrismaService } from './prisma.service'

import { MetricsService } from '@/infrastructure/observability'

describe('DbPoolMetricsCollector', () => {
  it('registers current pool snapshots at scrape time', async () => {
    const env = {
      get: jest.fn((key: string) => {
        const values: Record<string, unknown> = {
          PROCESS_ROLE: 'worker',
          NODE_ENV: 'test',
          METRICS_ENABLED: true,
        }
        return values[key]
      }),
    }
    const metrics = new MetricsService(env as never)
    const prisma = {
      getPoolStats: jest
        .fn()
        .mockReturnValueOnce({ total: 5, idle: 3, waiting: 1 })
        .mockReturnValueOnce({ total: 7, idle: 2, waiting: 4 }),
    } as unknown as PrismaService

    new DbPoolMetricsCollector(metrics, prisma)

    const first = await metrics.metrics()
    expect(first).toContain('amcore_db_pool_connections{state="total"')
    expect(first).toContain(' 5')
    expect(first).toContain('amcore_db_pool_connections{state="idle"')
    expect(first).toContain('amcore_db_pool_connections{state="waiting"')

    const second = await metrics.metrics()
    expect(second).toContain('amcore_db_pool_connections{state="total"')
    expect(second).toContain(' 7')
    expect(prisma.getPoolStats).toHaveBeenCalledTimes(2)

    metrics.onModuleDestroy()
  })
})
