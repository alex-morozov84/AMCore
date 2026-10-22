import { execSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import type { PinoLogger } from 'nestjs-pino'

import { ChannelDelivererRegistry } from '../../src/core/notifications/channels/channel-deliverer.registry'
import { NotificationAttemptAdmission } from '../../src/core/notifications/dispatch/notification-attempt-admission'
import { NotificationDeliveryRepository } from '../../src/core/notifications/dispatch/notification-delivery.repository'
import { NotificationDispatchGate } from '../../src/core/notifications/dispatch/notification-dispatch.gate'
import { NotificationDispatchService } from '../../src/core/notifications/dispatch/notification-dispatch.service'
import { NotificationShutdownLatch } from '../../src/core/notifications/dispatch/notification-shutdown.latch'
import type { EnvService } from '../../src/env/env.service'
import { WorkReadiness } from '../../src/infrastructure/background-work/work-readiness'
import type { MetricsService } from '../../src/infrastructure/observability'
import { cycleOutcome } from '../../src/infrastructure/schedule/dispatch-cycle'
import { succeeded } from '../../src/infrastructure/schedule/scheduled-job'
import { ScheduledJobExecutor } from '../../src/infrastructure/schedule/scheduled-job.executor'
import { ScheduledJobRecorder } from '../../src/infrastructure/schedule/scheduled-job-recorder'
import {
  AI_RUN_RECOVERY_JOB,
  CLEANUP_JOB,
  INVITATION_HANDOFF_JOB,
  NOTIFICATION_RECOVERY_JOB,
  SCHEDULED_JOBS,
} from '../../src/infrastructure/schedule/scheduled-jobs.catalogue'
import type { SingletonCronRunner } from '../../src/infrastructure/schedule/singleton-cron.runner'
import { PrismaService } from '../../src/prisma/prisma.service'
import { e2eContainerLabels } from '../e2e-owned-containers'
import { migrateTestDatabase } from '../helpers'

/**
 * On-demand measurement of the scheduled-job recorder. It is NOT part of the regular suites and the
 * e2e wrapper (`pnpm test:e2e`) refuses it, because that wrapper accepts only inventory paths.
 * Needs Docker. From the repository root run `node scripts/api-e2e-ci.mjs --prepare` once, then from
 * `apps/api`:
 *
 *   NODE_OPTIONS=--experimental-vm-modules node_modules/.bin/jest -c jest-e2e.config.js \
 *     --testMatch '<rootDir>/test/measure/*.measure.ts' \
 *     --runTestsByPath test/measure/scheduled-job-overhead.measure.ts
 *
 * Add `--listTests` to check discovery (it must print this file). Add `--testNamePattern` to run one
 * group, and set DOCKER_HOST when the container runtime is not at /var/run/docker.sock. For example `'hung recorder connection'`. The whole file takes about 12 minutes.
 * It uses the real PrismaService (a real pg pool), the real recorder and a real Postgres. Results
 * are printed as `MEASURE {json}` lines and appended to $MEASURE_OUT when it is set.
 *
 * Method: a "business" load of short queries (2 ms of work each) runs against the same pool while the
 * recorder is OFF (no begin/finish) and then ON, at a recording rate far above the real one. Latency
 * of each business query is the time to get its connection and finish. Two outage shapes are covered:
 * the whole database container paused for 65 s (jobs keep starting and finishing in memory), and a
 * hung recorder connection with a healthy database (only the recorder's own transaction stalls for
 * 65 s while the real recovery service runs its real SQL; evidence must reach the database after).
 */
const out = (row: Record<string, unknown>): void => {
  const line = `MEASURE ${JSON.stringify(row)}`
  process.stdout.write(`${line}\n`)
  if (process.env.MEASURE_OUT) appendFileSync(process.env.MEASURE_OUT, `${line}\n`)
}
const percentile = (sorted: number[], p: number): number =>
  sorted.length === 0
    ? 0
    : (sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number)
interface Stats {
  n: number
  p50: number
  p95: number
  p99: number
  max: number
}
const stats = (values: number[]): Stats => {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    n: sorted.length,
    p50: +percentile(sorted, 0.5).toFixed(3),
    p95: +percentile(sorted, 0.95).toFixed(3),
    p99: +percentile(sorted, 0.99).toFixed(3),
    max: +(sorted.at(-1) ?? 0).toFixed(3),
  }
}
const sleep = (ms: number): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, ms))

describe('scheduled job recorder overhead', () => {
  let container: StartedPostgreSqlContainer
  let url: string

  const logger = {
    setContext: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    info: () => undefined,
  } as unknown as PinoLogger
  const metrics = { incDbSlowQuery: () => undefined } as unknown as MetricsService

  interface Rig {
    prisma: PrismaService
    recorder: ScheduledJobRecorder
    executor: ScheduledJobExecutor
    transactions: () => number
    stop: () => Promise<void>
  }

  async function rig(poolMax: number): Promise<Rig> {
    const values: Record<string, unknown> = {
      DATABASE_URL: url,
      DATABASE_POOL_MAX: poolMax,
      DATABASE_POOL_IDLE_MS: 30_000,
      DATABASE_CONNECT_MS: 3000,
      DATABASE_STATEMENT_TIMEOUT_MS: 5000,
      DATABASE_QUERY_TIMEOUT_MS: 8000,
      PROCESS_ROLE: 'all',
      NODE_ENV: 'test',
      SLOW_QUERY_THRESHOLD_MS: 100000,
    }
    const env = { get: (key: string) => values[key] } as EnvService
    const prisma = new PrismaService(env, logger, metrics)
    await prisma.onModuleInit()
    const recorder = new ScheduledJobRecorder(prisma, logger)
    recorder.registerJobs([...SCHEDULED_JOBS], () => null)
    const runner = {
      run: async (_: unknown, fn: () => Promise<void>) => {
        await fn()
        return { status: 'ran' }
      },
    } as unknown as SingletonCronRunner
    const executor = new ScheduledJobExecutor(recorder, runner)
    // Count what the recorder sends to the database.
    let transactions = 0
    const original = prisma.$transaction.bind(prisma) as (...args: unknown[]) => unknown
    ;(prisma as unknown as { $transaction: unknown }).$transaction = (...args: unknown[]) => {
      transactions += 1
      return original(...args)
    }
    return {
      prisma,
      recorder,
      executor,
      transactions: () => transactions,
      stop: async () => {
        recorder.onModuleDestroy()
        await prisma.onModuleDestroy()
      },
    }
  }

  /** Business queries from `workers` loops for `ms`; returns the latency of each (milliseconds). */
  async function business(prisma: PrismaService, workers: number, ms: number): Promise<number[]> {
    const latencies: number[] = []
    const until = performance.now() + ms
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (performance.now() < until) {
          const t0 = performance.now()
          await prisma.$queryRaw`SELECT (pg_sleep(0.002) IS NULL)::int AS done`
          latencies.push(performance.now() - t0)
        }
      })
    )
    return latencies
  }

  /** The recording load: daily begin/finish and frequent finishes, far above the real cadence. */
  function recording(
    r: Rig,
    ms: number
  ): { done: Promise<void>; startLatency: number[]; runs: () => number } {
    const until = performance.now() + ms
    const startLatency: number[] = []
    let runs = 0
    const loop = (async () => {
      while (performance.now() < until) {
        for (const job of [
          NOTIFICATION_RECOVERY_JOB,
          AI_RUN_RECOVERY_JOB,
          INVITATION_HANDOFF_JOB,
        ]) {
          const t0 = performance.now()
          await r.executor.run(job, async () => {
            startLatency.push(performance.now() - t0)
            return succeeded()
          })
          runs += 1
        }
        const t0 = performance.now()
        await r.executor.run(CLEANUP_JOB, async () => {
          startLatency.push(performance.now() - t0)
          return succeeded({ counts: { expiredSessions: 1 }, codes: [] })
        })
        runs += 1
        await sleep(10)
      }
    })()
    return { done: loop, startLatency, runs: () => runs }
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    url = container.getConnectionUri()
    await migrateTestDatabase(url)
  }, 180_000)
  afterAll(async () => {
    await container?.stop()
  }, 60_000)

  it.each([
    [1, 1],
    [2, 2],
    [10, 10],
    [2, 1],
    [10, 5],
  ])(
    'pool %i with %i business workers: recorder off and on',
    async (poolMax, workers) => {
      const off = await rig(poolMax)
      await business(off.prisma, workers, 1500) // warm-up
      const baseline = await business(off.prisma, workers, 12_000)
      await off.stop()

      const on = await rig(poolMax)
      await business(on.prisma, workers, 1500)
      let maxWaiting = 0
      let maxTotal = 0
      const sampler = setInterval(() => {
        const pool = on.prisma.poolStats()
        maxWaiting = Math.max(maxWaiting, pool.waiting)
        maxTotal = Math.max(maxTotal, pool.total)
      }, 5)
      const load = recording(on, 12_000)
      const withRecorder = await business(on.prisma, workers, 12_000)
      await load.done
      clearInterval(sampler)
      await sleep(2500)
      const rows = await on.prisma.scheduledJobRun.count()
      const summaries = await on.prisma.scheduledJobSummary.count()
      out({
        case: 'overhead',
        poolMax,
        businessWorkers: workers,
        businessOff: stats(baseline),
        businessOn: stats(withRecorder),
        p95GrowthPct: +(
          ((percentile(
            [...withRecorder].sort((a, b) => a - b),
            0.95
          ) -
            percentile(
              [...baseline].sort((a, b) => a - b),
              0.95
            )) /
            percentile(
              [...baseline].sort((a, b) => a - b),
              0.95
            )) *
          100
        ).toFixed(1),
        throughputOffPerS: +(baseline.length / 12).toFixed(1),
        throughputOnPerS: +(withRecorder.length / 12).toFixed(1),
        recordedRuns: load.runs(),
        recorderTransactions: on.transactions(),
        recorderTransactionsPerS: +(on.transactions() / 14).toFixed(2),
        startLatencyMs: stats(load.startLatency),
        maxPoolWaiting: maxWaiting,
        maxPoolTotal: maxTotal,
        runRows: rows,
        summaryRows: summaries,
      })
      if (poolMax === 1) expect(on.transactions()).toBe(0)
      expect(maxTotal).toBeLessThanOrEqual(poolMax)
      expect(rows).toBeLessThanOrEqual(2560)
      await on.stop()
    },
    120_000
  )

  it('hung database for 65 s: jobs are never delayed and memory stays bounded', async () => {
    const r = await rig(10)
    r.recorder.finish(CLEANUP_JOB, r.recorder.begin(CLEANUP_JOB), succeeded())
    await sleep(3000)
    const heapBefore = process.memoryUsage().heapUsed
    execSync(`docker pause ${container.getId()}`)
    const begins: number[] = []
    const finishes: number[] = []
    let finishedJobs = 0
    const until = performance.now() + 65_000
    try {
      while (performance.now() < until) {
        for (const job of [CLEANUP_JOB, NOTIFICATION_RECOVERY_JOB, AI_RUN_RECOVERY_JOB]) {
          const t0 = performance.now()
          const run = r.recorder.begin(job)
          const t1 = performance.now()
          r.recorder.finish(job, run, succeeded())
          const t2 = performance.now()
          begins.push(t1 - t0)
          finishes.push(t2 - t1)
          finishedJobs += 1
        }
        await sleep(2)
      }
    } finally {
      execSync(`docker unpause ${container.getId()}`)
    }
    const pending = (
      r.recorder as unknown as {
        pending: {
          evidence: Map<string, unknown>
          records: Map<string, unknown>
          open: Map<string, unknown>
        }
      }
    ).pending
    const held = {
      evidence: pending.evidence.size,
      records: pending.records.size,
      open: pending.open.size,
    }
    await sleep(75_000) // degraded mode (5 min) is not waited for; retries continue with backoff
    const heapAfter = process.memoryUsage().heapUsed
    out({
      case: 'hung-database',
      pausedMs: 65_000,
      completedJobCalls: finishedJobs,
      beginMs: stats(begins),
      finishMs: stats(finishes),
      pendingAtEndOfHang: held,
      heapGrowthMb: +((heapAfter - heapBefore) / 1_048_576).toFixed(1),
    })
    expect(held.evidence).toBeLessThanOrEqual(SCHEDULED_JOBS.length * 4)
    expect(held.records).toBeLessThanOrEqual(SCHEDULED_JOBS.length * 10)
    expect(stats(begins).p99).toBeLessThan(5)
    expect(stats(finishes).p99).toBeLessThan(5)
    await r.stop()
  }, 240_000)

  /**
   * The recorder's connection hangs while the database itself is healthy. The stall is injected
   * only into the recorder's own transactions (it holds a real pool connection for `stallMs`),
   * while the business side is the real recovery service with its real SQL (reap + claim).
   */
  interface StalledRig {
    prisma: PrismaService
    dispatch: NotificationDispatchService
    executor: ScheduledJobExecutor
    counters: { started: number; concurrent: number; maxConcurrent: number; stalled: number }
    stop: () => Promise<void>
  }

  async function stalledRig(poolMax: number, stallMs: number): Promise<StalledRig> {
    const values: Record<string, unknown> = {
      DATABASE_URL: url,
      DATABASE_POOL_MAX: poolMax,
      DATABASE_POOL_IDLE_MS: 30_000,
      DATABASE_CONNECT_MS: 3000,
      // Worst case: no client-side timeout shorter than the stall. With the production defaults the
      // pool cuts a hung query off after DATABASE_QUERY_TIMEOUT_MS, which only shortens the stall.
      DATABASE_STATEMENT_TIMEOUT_MS: 120_000,
      DATABASE_QUERY_TIMEOUT_MS: 120_000,
      PROCESS_ROLE: 'all',
      NODE_ENV: 'test',
      SLOW_QUERY_THRESHOLD_MS: 100000,
    }
    const prisma = new PrismaService(
      { get: (key: string) => values[key] } as EnvService,
      logger,
      metrics
    )
    await prisma.onModuleInit()
    const latch = new NotificationShutdownLatch(logger)
    const readiness = new WorkReadiness()
    readiness.open()
    const dispatch = new NotificationDispatchService(
      prisma,
      new NotificationDeliveryRepository(prisma, latch),
      new ChannelDelivererRegistry([]),
      metrics,
      logger,
      latch,
      new NotificationDispatchGate(latch),
      new NotificationAttemptAdmission(prisma, latch),
      readiness
    )
    const counters = { started: 0, concurrent: 0, maxConcurrent: 0, stalled: 0 }
    // A separate object: the recorder uses only these two members, and the shared client (a Proxy)
    // must stay untouched so the stall can reach nothing but the recorder's own transactions.
    const recorderPrisma = { poolStats: () => prisma.poolStats() } as unknown as PrismaService
    const original = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>
    ;(recorderPrisma as unknown as { $transaction: unknown }).$transaction = (
      work: (tx: PrismaService) => Promise<unknown>,
      options: Record<string, unknown>
    ) => {
      counters.started += 1
      counters.concurrent += 1
      counters.maxConcurrent = Math.max(counters.maxConcurrent, counters.concurrent)
      const hang = counters.started === 1 ? stallMs : 0
      return original(
        async (tx: PrismaService) => {
          if (hang > 0) {
            counters.stalled += 1
            await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 0')
            await tx.$queryRawUnsafe(`SELECT (pg_sleep(${hang / 1000}) IS NULL)::int AS done`)
          }
          return work(tx)
        },
        { ...options, timeout: hang + 15_000 }
      ).finally(() => {
        counters.concurrent -= 1
      })
    }
    const recorder = new ScheduledJobRecorder(recorderPrisma, logger)
    recorder.registerJobs([...SCHEDULED_JOBS], () => null)
    const executor = new ScheduledJobExecutor(recorder, {
      run: async (_: unknown, fn: () => Promise<void>) => {
        await fn()
        return { status: 'ran' }
      },
    } as unknown as SingletonCronRunner)
    return {
      prisma,
      dispatch,
      executor,
      counters,
      stop: async () => {
        recorder.onModuleDestroy()
        await prisma.onModuleDestroy()
      },
    }
  }

  /** Real recovery passes back to back (through the executor when `record`), latency of each. */
  async function recoveryLoop(r: StalledRig, ms: number, record: boolean): Promise<number[]> {
    const latencies: number[] = []
    const until = performance.now() + ms
    while (performance.now() < until) {
      const t0 = performance.now()
      if (record)
        await r.executor.run(NOTIFICATION_RECOVERY_JOB, async () =>
          cycleOutcome(await r.dispatch.runDispatchCycle())
        )
      else await r.dispatch.runDispatchCycle()
      latencies.push(performance.now() - t0)
      await sleep(5)
    }
    return latencies
  }

  it.each([
    [1, 0],
    [2, 0],
    [10, 5],
  ])(
    'pool %i with %i business workers: recorder connection hung for 65 s, database healthy',
    async (poolMax, workers) => {
      const off = await stalledRig(poolMax, 0)
      await recoveryLoop(off, 1500, false)
      const [offRecovery, offBusiness] = await Promise.all([
        recoveryLoop(off, 10_000, false),
        business(off.prisma, workers, 10_000),
      ])
      await off.stop()

      const on = await stalledRig(poolMax, 65_000)
      let maxPoolTotal = 0
      let maxWaiting = 0
      const sampler = setInterval(() => {
        const pool = on.prisma.poolStats()
        maxPoolTotal = Math.max(maxPoolTotal, pool.total)
        maxWaiting = Math.max(maxWaiting, pool.waiting)
      }, 5)
      const [onRecovery, onBusiness] = await Promise.all([
        recoveryLoop(on, 66_000, true),
        workers > 0 ? business(on.prisma, workers, 66_000) : Promise.resolve([] as number[]),
      ])
      clearInterval(sampler)
      const during = { started: on.counters.started, stalled: on.counters.stalled }
      // The stall is over: the recorded results must reach the database by themselves.
      // A pool of one never lets the recorder write, so there is nothing to wait for.
      const deadline = performance.now() + (poolMax >= 2 ? 120_000 : 0)
      let written = false
      while (performance.now() < deadline && !written) {
        await recoveryLoop(on, 1000, true)
        const row = await on.prisma.scheduledJobSummary.findUnique({
          where: { jobId: NOTIFICATION_RECOVERY_JOB.id },
        })
        written = row?.successRunId != null
      }
      const growth = (a: number[], b: number[]): number => {
        const p = (v: number[]): number =>
          percentile(
            [...v].sort((x, y) => x - y),
            0.95
          )
        return p(a) === 0 ? 0 : +(((p(b) - p(a)) / p(a)) * 100).toFixed(1)
      }
      out({
        case: 'hung-recorder-connection',
        poolMax,
        businessWorkers: workers,
        recoveryOff: stats(offRecovery),
        recoveryOn: stats(onRecovery),
        recoveryP95GrowthPct: growth(offRecovery, onRecovery),
        recoveryPassesOff: offRecovery.length,
        recoveryPassesOn: onRecovery.length,
        businessOff: stats(offBusiness),
        businessOn: stats(onBusiness),
        businessP95GrowthPct: growth(offBusiness, onBusiness),
        recorderTransactionsDuringHang: during.started,
        recorderStalledTransactions: during.stalled,
        maxConcurrentRecorderTransactions: on.counters.maxConcurrent,
        maxPoolTotal,
        maxPoolWaiting: maxWaiting,
        evidenceReachedDatabaseAfterHang: written,
      })
      expect(on.counters.maxConcurrent).toBeLessThanOrEqual(1)
      expect(maxPoolTotal).toBeLessThanOrEqual(poolMax)
      if (poolMax === 1) expect(during.started).toBe(0)
      expect(onRecovery.length).toBeGreaterThan(0)
      if (poolMax === 10) expect(growth(offBusiness, onBusiness)).toBeLessThanOrEqual(10)
      if (poolMax >= 2) expect(written).toBe(true)
      await on.stop()
    },
    420_000
  )
})
