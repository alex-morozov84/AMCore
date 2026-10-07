import { SchedulerRegistry } from '@nestjs/schedule'

import { seedAiCatalog } from '../prisma/seed-ai-catalog'
import { AiRunProducerService } from '../src/core/ai/runs/ai-run-producer.service'
import { AI_PROVIDER_ADAPTERS } from '../src/infrastructure/ai/gateway/ai-gateway.types'
import { ModelGateway } from '../src/infrastructure/ai/gateway/model-gateway.service'
import { AiRunDispatchProcessor } from '../src/infrastructure/ai/runs/ai-run-dispatch.processor'
import { reconstructRounds } from '../src/infrastructure/ai/runs/ai-run-loop-reconstruct'
import { callProvider } from '../src/infrastructure/ai/runs/ai-run-provider-call'
import { AiToolRecoveryService } from '../src/infrastructure/ai/runs/ai-tool-recovery.service'
import { REDIS_CLIENT } from '../src/infrastructure/redis'
import { AttemptRuntime, CUTOFF, ShutdownLatch } from '../src/infrastructure/worker-lifecycle'

import { ControllableAdapter, controls, deferred } from './fixtures/ai-run-controls'
import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

/**
 * Multi-await helpers inside the worker must fence EVERY actual operation start (Track C — ADR-054): a
 * continuation resuming after the shutdown seal starts no further query, even though an outer wrapper
 * already released its waiter. Each case delays the FIRST operation across the seal and counts later starts.
 */
describe('AI run shutdown seal inside nested helpers (e2e)', () => {
  let context: E2ETestContext
  let sequence = 0

  beforeAll(async () => {
    context = await setupE2ETest((builder) =>
      builder.overrideProvider(AI_PROVIDER_ADAPTERS).useValue([new ControllableAdapter()])
    )
    for (const cron of context.app.get(SchedulerRegistry, { strict: false }).getCronJobs().values())
      cron.stop()
    await context.app.get(AiRunDispatchProcessor, { strict: false }).worker.close()
  }, 180000)
  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    controls.reset()
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
    await seedAiCatalog(context.prisma)
  })

  async function queueRun() {
    const email = `nested-${++sequence}@example.com`
    const user = await context.prisma.user.create({
      data: { email, emailCanonical: email, passwordHash: 'x' },
    })
    const conversation = await context.prisma.aiConversation.create({
      data: { ownerUserId: user.id },
    })
    return context.app.get(AiRunProducerService, { strict: false }).create(user.id, {
      conversationId: conversation.id,
      inputParts: [{ type: 'text', text: 'hello' }],
    })
  }
  const newLatch = () => new ShutdownLatch({ warn: () => undefined }, 'ai.run')
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

  /** Wraps a delegate method: the first call settles, then waits for `release`; counts every LATER call. */
  function delayFirst<K extends string>(
    delegate: Record<K, (...args: never[]) => unknown>,
    method: K,
    entered: { resolve: () => void },
    release: Promise<unknown>
  ): { restore: () => void; laterStarts: () => number } {
    const original = delegate[method]
    let calls = 0
    let later = 0
    delegate[method] = (async (...args: never[]) => {
      calls += 1
      if (calls > 1) later += 1
      const result = await (original as (...a: never[]) => unknown).apply(delegate, args)
      if (calls === 1) {
        entered.resolve()
        await release
      }
      return result
    }) as never
    return {
      restore: () => {
        delegate[method] = original
      },
      laterStarts: () => later,
    }
  }

  it('recovery starts no pending-list query when sealed during the unknown-effect query', async () => {
    const run = await queueRun()
    const latch = newLatch()
    const entered = deferred()
    const release = deferred()
    const probe = delayFirst(
      context.prisma.aiToolInvocation as never,
      'findFirst',
      entered,
      release.promise
    )
    const invocations = context.prisma.aiToolInvocation as unknown as {
      findMany: (...args: never[]) => unknown
    }
    const originalMany = invocations.findMany
    let pendingListReads = 0
    invocations.findMany = ((...args: never[]) => {
      pendingListReads += 1
      return originalMany.apply(invocations, args)
    }) as never
    try {
      const service = new AiToolRecoveryService(
        context.prisma,
        {} as never,
        {} as never,
        {} as never,
        latch
      )
      const recovery = service.recover({ claim: { id: run.id } } as never)
      await entered.promise
      latch.seal()
      release.resolve()
      expect(await recovery).toBe('done')
      await flush()
      expect(pendingListReads).toBe(0)
    } finally {
      release.resolve()
      invocations.findMany = originalMany
      probe.restore()
    }
  })

  it('reconstruction starts no invocation query when sealed during the steps query', async () => {
    const run = await queueRun()
    await context.prisma.aiRunStep.create({
      data: {
        runId: run.id,
        stepNumber: 1,
        type: 'TOOL_INVOCATION',
        detail: { invocationId: 'legacy-inv', toolCallId: 'legacy-call' },
      },
    })
    const latch = newLatch()
    const entered = deferred()
    const release = deferred()
    const steps = delayFirst(
      context.prisma.aiRunStep as never,
      'findMany',
      entered,
      release.promise
    )
    let invocationReads = 0
    const invocations = context.prisma.aiToolInvocation as unknown as {
      findMany: (...args: never[]) => unknown
    }
    const originalInvocations = invocations.findMany
    invocations.findMany = ((...args: never[]) => {
      invocationReads += 1
      return originalInvocations.apply(invocations, args)
    }) as never
    try {
      const reconstruction = reconstructRounds(context.prisma, run.id, (op) => latch.run(op))
      await entered.promise
      latch.seal()
      release.resolve()
      expect(await reconstruction).toBe(CUTOFF)
      await flush()
      expect(invocationReads).toBe(0)
    } finally {
      release.resolve()
      invocations.findMany = originalInvocations
      steps.restore()
    }
  })

  it('catalog fallback starts no database or transport work after a Redis miss resumes across the seal', async () => {
    const latch = newLatch()
    const runtime = new AttemptRuntime(latch.openAttempt())
    const entered = deferred()
    const release = deferred()
    const redis = context.app.get(REDIS_CLIENT, { strict: false }) as {
      get: (...args: unknown[]) => Promise<unknown>
    }
    const originalGet = redis.get
    const providers = context.prisma.aiProvider as unknown as {
      findMany: (...args: never[]) => unknown
    }
    const originalFind = providers.findMany
    let databaseReads = 0
    redis.get = async function (...args: unknown[]) {
      if (args[0] !== 'ai:catalog:v1') return originalGet.apply(this, args)
      entered.resolve()
      await release.promise
      return null
    }
    providers.findMany = ((...args: never[]) => {
      databaseReads += 1
      return originalFind.apply(providers, args)
    }) as never
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
      redis.get = originalGet
      providers.findMany = originalFind
    }
  })
})
