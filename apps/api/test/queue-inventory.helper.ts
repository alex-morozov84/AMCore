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
export interface QueueGraphOptions {
  /**
   * Evaluate the mount gate as PRODUCTION: `NODE_ENV=production` while the modules are imported (that
   * is when the gate reads the environment), with the few values production validation insists on.
   * It is switched back to `test` before the graph is compiled.
   */
  productionAtImport?: boolean
  /**
   * Set AFTER the modules are imported, the way a `.env` loaded by `ConfigModule` later would: the
   * mount decision is already taken and must not change.
   */
  lateEnableBullBoard?: string
}

export async function compileQueueGraph(
  role: 'web' | 'worker',
  options: QueueGraphOptions = {}
): Promise<CompiledQueueGraph> {
  const production = options.productionAtImport === true
  process.env.DATABASE_URL = production
    ? 'postgresql://u:p@localhost:5432/test?sslmode=require&schema=public'
    : (process.env.DATABASE_URL ?? 'postgresql://u:p@localhost:5432/test?schema=public')
  process.env.JWT_SECRET ??= 'test-only-jwt-secret-at-least-32-characters-long'
  const redis = await new RedisContainer('redis:7-alpine').start()
  process.env.REDIS_URL = redis.getConnectionUrl()
  process.env.NODE_ENV = production ? 'production' : 'test'
  if (production) {
    process.env.CORS_ORIGIN = 'https://app.example.com'
    // Production would default to S3 and then demand a bucket and keys: irrelevant to the mount gate.
    process.env.STORAGE_DRIVER = 'local'
  }
  process.env.PROCESS_ROLE = role
  delete process.env.ENABLE_BULL_BOARD

  const root =
    role === 'web'
      ? (await import('../src/web.module')).WebModule
      : (await import('../src/worker.module')).WorkerModule
  const { QueueService } = await import('../src/infrastructure/queue')
  const { BULL_BOARD_ADAPTER } = await import('@bull-board/nestjs')
  // The decision is taken; from here on the process looks like a later `.env` load happened.
  process.env.NODE_ENV = 'test'
  if (options.lateEnableBullBoard !== undefined) {
    process.env.ENABLE_BULL_BOARD = options.lateEnableBullBoard
  }
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

/** Disable the definition in the single registration owner before compiling either role. */
export async function disableDefaultQueue(): Promise<void> {
  const { jest } = await import('@jest/globals')
  const actual = await import('../src/background-work.composition')
  jest.unstable_mockModule('../src/background-work.composition', () => ({
    ...actual,
    BACKGROUND_WORK: actual.BACKGROUND_WORK.map((entry) =>
      entry.definition.id === 'default'
        ? {
            ...entry,
            definition: {
              ...entry.definition,
              queue: { ...entry.definition.queue!, enabled: false },
            },
          }
        : entry
    ),
  }))
}
