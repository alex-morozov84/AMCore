import type { PinoLogger } from 'nestjs-pino'

import type { EnvService } from '../../src/env/env.service'
import type { MetricsService } from '../../src/infrastructure/observability'
import { PrismaService } from '../../src/prisma/prisma.service'

/** Actual main/private clients prove one pool, role identity and close-before-barrier teardown. */
export function observedPrismaRoleProof(databaseUrl: () => string): void {
  it.each(['web', 'worker', 'all'])(
    'observed capabilities retain shared pool and shutdown ordering in %s role',
    async (role) => {
      const values: Record<string, unknown> = {
        DATABASE_URL: databaseUrl(),
        DATABASE_POOL_MAX: 2,
        DATABASE_POOL_IDLE_MS: 1000,
        DATABASE_CONNECT_MS: 1000,
        DATABASE_STATEMENT_TIMEOUT_MS: 1500,
        DATABASE_QUERY_TIMEOUT_MS: 2000,
        PROCESS_ROLE: role,
        NODE_ENV: 'test',
        SLOW_QUERY_THRESHOLD_MS: 100,
      }
      const env = { get: (key: string) => values[key] } as EnvService
      const logger = {
        setContext: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      } as unknown as PinoLogger
      const metrics = { incDbSlowQuery: () => undefined } as unknown as MetricsService
      const prisma = new PrismaService(env, logger, metrics)
      await prisma.onModuleInit()
      let destroyed = false
      try {
        const catalogue = prisma.observedTransactions('ai-catalogue')
        const diagnosis = prisma.observedTransactions('ai-diagnosis')
        const main = await prisma.$queryRaw<
          { pid: number; role: string }[]
        >`SELECT pg_backend_pid() AS pid, current_setting('application_name') AS role`
        for (const runner of [catalogue, diagnosis]) {
          const operation = runner.start(
            (tx) =>
              tx.$queryRaw<
                { pid: number; role: string }[]
              >`SELECT pg_backend_pid() AS pid, current_setting('application_name') AS role`
          )
          const child = await operation.result
          await operation.physicalCompletion
          expect(child).toEqual(main)
        }
        expect(main[0]!.role).toBe(`amcore-${role}`)
        expect(prisma.getPoolStats()).toEqual({ total: 1, idle: 1, waiting: 0 })
        let barrierRan = false
        prisma.registerShutdownBarrier(async () => {
          expect(() => catalogue.start(async () => undefined)).toThrow(
            'observed_transaction_unavailable'
          )
          expect(() => diagnosis.start(async () => undefined)).toThrow(
            'observed_transaction_unavailable'
          )
          expect((await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`)[0]!.ok).toBe(1)
          barrierRan = true
        })
        await prisma.onModuleDestroy()
        destroyed = true
        expect(barrierRan).toBe(true)
        expect(prisma.getPoolStats()).toEqual({ total: 0, idle: 0, waiting: 0 })
        expect(() => prisma.observedTransactions('ai-catalogue')).toThrow(
          'prisma_shutdown_registration_closed'
        )
      } finally {
        if (!destroyed) await prisma.onModuleDestroy()
      }
    }
  )
}
