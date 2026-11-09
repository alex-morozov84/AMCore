import { SchedulerRegistry } from '@nestjs/schedule'

import { seedAiCatalog } from '../src/core/system-seed/seed-ai-catalog'
import { AI_PROVIDER_ADAPTERS } from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { ModelGateway } from '../src/infrastructure/ai/gateway/model-gateway.service'
import { AiModelRegistry } from '../src/infrastructure/ai/registry/ai-model-registry.service'
import { callProvider } from '../src/infrastructure/ai/runs/ai-run-provider-call'
import type { AppRedisClient } from '../src/infrastructure/redis'
import { REDIS_CLIENT } from '../src/infrastructure/redis'
import { AttemptRuntime, ShutdownLatch } from '../src/infrastructure/worker-lifecycle'

import { ControllableAdapter, controls, deferred } from './fixtures/ai-run-controls'
import { closeManagedWorker } from './fixtures/background-work/close-managed-worker'
import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

/**
 * Multi-await helpers inside the worker must fence EVERY actual operation start (Track C — ADR-054): a
 * continuation resuming after the shutdown seal starts no further query, even though an outer wrapper
 * already released its waiter. This assembled case delays the Redis miss across the seal and counts later starts.
 * Recovery/reconstruction query routing is covered in their ordinary unit suites.
 */
describe('AI run shutdown seal inside nested helpers (e2e)', () => {
  let context: E2ETestContext

  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      builder.overrideProvider(AI_PROVIDER_ADAPTERS).useValue([new ControllableAdapter()])
    )
    for (const cron of context.app.get(SchedulerRegistry, { strict: false }).getCronJobs().values())
      cron.stop()
    await closeManagedWorker(context.app, 'ai-runs')
  }, 180000)
  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    controls.reset()
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
    await seedAiCatalog(context.prisma)
    await context.app.get(AiModelRegistry, { strict: false }).invalidate()
  })

  const newLatch = () => new ShutdownLatch({ warn: () => undefined }, 'ai.run')

  it('catalog fallback starts no database or transport work after a Redis miss resumes across the seal', async () => {
    const latch = newLatch()
    const runtime = new AttemptRuntime(latch.openAttempt())
    const entered = deferred()
    const release = deferred()
    const redis = context.app.get<AppRedisClient>(REDIS_CLIENT, { strict: false })
    const originalOptions = redis.withCommandOptions
    const runner = context.prisma.observedTransactions('ai-catalogue')
    const originalStart = runner.start
    const start = runner.start.bind(runner)
    let databaseReads = 0
    redis.withCommandOptions = (() => ({
      eval: async () => {
        entered.resolve()
        await release.promise
        return ['00000000-0000-0000-0000-000000000000', null]
      },
    })) as unknown as typeof originalOptions
    runner.start = (operation) => {
      databaseReads++
      return start(operation)
    }
    try {
      const gateway = context.app.get(ModelGateway, { strict: false })
      const call = callProvider(
        gateway,
        {
          modelSlug: 'mock-default',
          system: 'review',
          messages: [{ role: 'user', content: 'hello' }],
          recordUsage: false,
        },
        { claim: { deadlineAt: null } as never, runtime, timeoutMs: 1000 }
      )
      const outcome = call.then(
        () => 'resolved',
        (error: { code?: string }) => error.code
      )
      await entered.promise
      latch.seal()
      release.resolve()
      expect(await outcome).toBe('aborted')
      await runtime.whenSettled()
      expect(databaseReads).toBe(0)
      expect(controls.providerCalls).toBe(0)
    } finally {
      release.resolve()
      runtime.attempt.dispose()
      redis.withCommandOptions = originalOptions
      runner.start = originalStart
    }
  })
})
