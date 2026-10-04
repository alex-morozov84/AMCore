import { Test, type TestingModule } from '@nestjs/testing'
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis'
import { PinoLogger } from 'nestjs-pino'

const noopLogger = {
  setContext: () => undefined,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  assign: () => undefined,
} as unknown as PinoLogger

export interface CompiledQueueGraph {
  module: TestingModule
  /** The suite's own Redis container (BullMQ connects eagerly even though `onModuleInit` is not run). */
  redis: StartedRedisContainer
  /** Queues registered with BullMQ and known to `QueueService`. */
  registered: string[]
  /** Whether the Bull Board adapter (the mount gate's marker: no mount, no provider) is in the graph. */
  boardMounted: boolean
}

export const STOCK_QUEUES = ['email', 'default', 'notifications', 'ai-runs']

/**
 * Resolves a real role graph (`web` or `worker`) WITHOUT `onModuleInit`. The Bull Board mount gate
 * and the queue inventory are evaluated at import time, so each spec sets `PROCESS_ROLE` (and
 * optionally mocks the inventory) BEFORE calling this. The production-without-opt-in branch of the
 * gate is a pure function covered by `bull-board-mount-gate.spec.ts`; the absent-board graph is
 * exercised here through the `worker` role, which takes the same module branch.
 */
export async function compileQueueGraph(role: 'web' | 'worker'): Promise<CompiledQueueGraph> {
  process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test?schema=public'
  process.env.JWT_SECRET ??= 'test-only-jwt-secret-at-least-32-characters-long'
  const redis = await new RedisContainer('redis:7-alpine').start()
  process.env.REDIS_URL = redis.getConnectionUrl()
  process.env.NODE_ENV = 'test'
  process.env.PROCESS_ROLE = role
  delete process.env.ENABLE_BULL_BOARD

  const root =
    role === 'web'
      ? (await import('../src/web.module')).WebModule
      : (await import('../src/worker.module')).WorkerModule
  const { QueueService } = await import('../src/infrastructure/queue')
  const { BULL_BOARD_ADAPTER } = await import('@bull-board/nestjs')
  const module = await Test.createTestingModule({ imports: [root] })
    .overrideProvider(PinoLogger)
    .useValue(noopLogger)
    .compile()

  const service = module.get(QueueService, { strict: false }) as unknown as {
    queues: ReadonlyMap<string, unknown>
  }
  let boardMounted = true
  try {
    module.get(BULL_BOARD_ADAPTER, { strict: false })
  } catch {
    boardMounted = false
  }
  return { module, redis, registered: [...service.queues.keys()], boardMounted }
}

export async function closeQueueGraph(graph?: CompiledQueueGraph): Promise<void> {
  await graph?.module.close().catch(() => undefined)
  await graph?.redis.stop().catch(() => undefined)
}

/** `default` marked disabled in the single inventory (call before `compileQueueGraph`). */
export async function disableDefaultQueue(): Promise<void> {
  const { jest } = await import('@jest/globals')
  const actual = await import('../src/infrastructure/queue/constants/queue-inventory.constant')
  jest.unstable_mockModule(
    '../src/infrastructure/queue/constants/queue-inventory.constant',
    () => ({
      ...actual,
      QUEUE_INVENTORY: actual.QUEUE_INVENTORY.map((queue) =>
        queue.name === 'default' ? { ...queue, enabled: false } : queue
      ),
    })
  )
}
