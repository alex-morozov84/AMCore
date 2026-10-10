import { Test } from '@nestjs/testing'
import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { PinoLogger } from 'nestjs-pino'

import { EnvService } from '../../../env/env.service'
import { PrismaService } from '../../../prisma'
import { ChannelDelivererRegistry } from '../channels/channel-deliverer.registry'
import { NOTIFICATION_SHUTDOWN_GRACE_MS } from '../notification-dispatch.constants'

import { NotificationAttemptAdmission } from './notification-attempt-admission'
import { NotificationDeliveryRepository } from './notification-delivery.repository'
import { NotificationDispatchGate } from './notification-dispatch.gate'
import { NotificationDispatchService } from './notification-dispatch.service'
import { NotificationShutdownLatch } from './notification-shutdown.latch'

import { WorkReadiness } from '@/infrastructure/background-work/work-readiness'
import { MetricsService } from '@/infrastructure/observability'

/**
 * Real Nest lifecycle (not a hand-rolled hook sequence): the notification drain registered as a
 * `PrismaService` shutdown barrier must complete — or hit its bounded cutoff — BEFORE the database
 * pool is torn down, regardless of module distance or provider order. Nest runs all destroy hooks
 * before `beforeApplicationShutdown`, and the hooks of one module concurrently, so only the
 * barrier makes this ordering a guarantee.
 */
describe('notification dispatch shutdown ordering (real Nest lifecycle)', () => {
  const envValues: Record<string, unknown> = {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    DATABASE_POOL_MAX: 10,
    DATABASE_POOL_IDLE_MS: 30_000,
    DATABASE_CONNECT_MS: 5_000,
    DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
    DATABASE_QUERY_TIMEOUT_MS: 30_000,
    NODE_ENV: 'test',
    SLOW_QUERY_THRESHOLD_MS: 100,
    PROCESS_ROLE: 'worker',
  }

  afterEach(() => jest.useRealTimers())

  async function build(
    events: string[],
    repository: DeepMockProxy<NotificationDeliveryRepository>
  ) {
    const logger = mockDeep<PinoLogger>()
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: EnvService, useValue: { get: (key: string) => envValues[key] } },
        { provide: PinoLogger, useValue: logger },
        {
          provide: MetricsService,
          useValue: { incDbSlowQuery: jest.fn(), incQueueEvent: jest.fn() },
        },
        {
          provide: PrismaService,
          inject: [EnvService, PinoLogger, MetricsService],
          useFactory: (env: EnvService, log: PinoLogger, metrics: MetricsService) => {
            const prisma = new PrismaService(env, log, metrics)
            // No real database: the connect/disconnect/pool calls are observed, not performed.
            jest.spyOn(prisma, '$connect').mockResolvedValue()
            jest.spyOn(prisma, '$disconnect').mockImplementation(async () => {
              events.push('prisma.$disconnect')
            })
            jest
              .spyOn((prisma as unknown as { pool: { end: () => Promise<void> } }).pool, 'end')
              .mockImplementation(async () => {
                events.push('prisma.pool.end')
              })
            return prisma
          },
        },
        NotificationShutdownLatch,
        {
          provide: NotificationDispatchGate,
          inject: [NotificationShutdownLatch],
          useFactory: (latch: NotificationShutdownLatch) => new NotificationDispatchGate(latch, 2),
        },
        { provide: NotificationDeliveryRepository, useValue: repository },
        { provide: ChannelDelivererRegistry, useValue: new ChannelDelivererRegistry([]) },
        {
          provide: NotificationAttemptAdmission,
          useValue: mockDeep<NotificationAttemptAdmission>(),
        },
        {
          provide: WorkReadiness,
          useFactory: () => {
            const readiness = new WorkReadiness()
            readiness.open()
            return readiness
          },
        },
        NotificationDispatchService,
      ],
    }).compile()
    return { app: moduleRef, latch: moduleRef.get(NotificationShutdownLatch) }
  }

  it('seals and drains the dispatcher before PrismaService disconnects (idle worker)', async () => {
    const events: string[] = []
    const repository = mockDeep<NotificationDeliveryRepository>()
    const { app, latch } = await build(events, repository)
    await app.init()
    jest
      .spyOn(latch, 'seal')
      .mockImplementation(NotificationShutdownLatchSealRecorder(latch, events))

    await app.close()

    expect(events.indexOf('latch.sealed')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('prisma.$disconnect')).toBeGreaterThan(events.indexOf('latch.sealed'))
    expect(events.filter((event) => event === 'prisma.$disconnect')).toHaveLength(1)
    expect(latch.sealed).toBe(true)
  })

  it('a pending claim does not delay teardown beyond the notification grace', async () => {
    jest.useFakeTimers()
    const events: string[] = []
    const repository = mockDeep<NotificationDeliveryRepository>()
    repository.claimDueBatch.mockImplementation(() => new Promise(() => undefined))
    const { app, latch } = await build(events, repository)
    await app.init()
    const service = app.get(NotificationDispatchService)

    const drain = service.drainDueBatches() // a lane stuck on a DB claim that never settles
    await jest.advanceTimersByTimeAsync(0)
    const closing = app.close()
    await jest.advanceTimersByTimeAsync(NOTIFICATION_SHUTDOWN_GRACE_MS)
    await Promise.all([closing, drain])

    expect(latch.sealed).toBe(true)
    expect(events).toEqual(['prisma.$disconnect', 'prisma.pool.end'])
  })
})

/** Wrap the real `seal()` so the test can see WHEN (relative to the Prisma teardown) it happened. */
function NotificationShutdownLatchSealRecorder(
  latch: NotificationShutdownLatch,
  events: string[]
): () => void {
  const realSeal = NotificationShutdownLatch.prototype.seal.bind(latch)
  return () => {
    if (!latch.sealed) events.push('latch.sealed')
    realSeal()
  }
}
