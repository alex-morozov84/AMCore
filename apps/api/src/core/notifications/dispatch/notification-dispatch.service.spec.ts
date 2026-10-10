import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import type { PinoLogger } from 'nestjs-pino'

import type { PrismaService } from '../../../prisma'
import { ChannelDelivererRegistry } from '../channels/channel-deliverer.registry'
import type {
  ChannelDeliverer,
  DeliveryAdmission,
  DeliveryResult,
  NotStarted,
} from '../channels/channel-deliverer.types'
import { NotificationChannel } from '../notification.constants'
import {
  NOTIFICATION_PROVIDER_TIMEOUT_MS,
  NOTIFICATION_SHUTDOWN_GRACE_MS,
} from '../notification-dispatch.constants'

import type {
  AdmissionRuntime,
  NotificationAttemptAdmission,
} from './notification-attempt-admission'
import { NotificationDeliveryRepository } from './notification-delivery.repository'
import { NotificationDispatchGate } from './notification-dispatch.gate'
import { NotificationDispatchService } from './notification-dispatch.service'
import type { ClaimedDelivery } from './notification-dispatch.types'
import { NotificationShutdownLatch } from './notification-shutdown.latch'

import { WorkReadiness } from '@/infrastructure/background-work/work-readiness'
import type { MetricsService } from '@/infrastructure/observability'

const makeClaim = (id: string): ClaimedDelivery => ({
  id,
  notificationId: `n-${id}`,
  channel: NotificationChannel.EMAIL,
  targetKey: 'user@example.com',
  targetRef: null,
  destinationSnapshot: null,
  locale: 'en',
  attemptNumber: 1,
  maxAttempts: 5,
  leaseToken: 'lease-1',
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type DeliverFn = (
  context: unknown,
  admission: DeliveryAdmission
) => Promise<DeliveryResult | NotStarted>

describe('NotificationDispatchService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let repository: DeepMockProxy<NotificationDeliveryRepository>
  let metrics: jest.Mocked<Pick<MetricsService, 'incQueueEvent' | 'incRedisClientEvent'>>
  let logger: DeepMockProxy<PinoLogger>
  let latch: NotificationShutdownLatch
  let gate: NotificationDispatchGate
  let deliver: jest.Mock<ReturnType<DeliverFn>, Parameters<DeliverFn>>
  let service: NotificationDispatchService

  /** Admission double: authorizes the single transport call immediately and reports it. */
  const admissions = {
    create: (
      _context: unknown,
      _deliverer: unknown,
      runtime: AdmissionRuntime
    ): DeliveryAdmission => ({
      send: async <T>(transport: (signal: AbortSignal) => Promise<T>): Promise<T | NotStarted> => {
        const started = transport(runtime.signal)
        runtime.onTransportStarted(started)
        return started
      },
    }),
  } as unknown as NotificationAttemptAdmission

  const buildService = (
    deliverers: ChannelDeliverer[],
    capacity = 2,
    ready = true
  ): NotificationDispatchService => {
    const readiness = new WorkReadiness()
    if (ready) readiness.open()
    gate = new NotificationDispatchGate(latch, capacity)
    return new NotificationDispatchService(
      prisma,
      repository,
      new ChannelDelivererRegistry(deliverers),
      metrics as unknown as MetricsService,
      logger,
      latch,
      gate,
      admissions,
      readiness
    )
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    repository = mockDeep<NotificationDeliveryRepository>()
    metrics = { incQueueEvent: jest.fn(), incRedisClientEvent: jest.fn() }
    logger = mockDeep<PinoLogger>()
    latch = new NotificationShutdownLatch(logger)
    deliver = jest.fn()

    prisma.notification.findUnique.mockResolvedValue({ id: 'n-d1', type: 'account.test' } as never)
    repository.finalizeDelivered.mockResolvedValue({ state: 'delivered' })
    repository.finalizeTransient.mockResolvedValue({
      state: 'retry_scheduled',
      nextAttemptAt: new Date(),
    })
    repository.finalizePermanent.mockResolvedValue({
      state: 'failed',
      reasonCode: 'x',
      deadLettered: true,
    })
    repository.reapExpiredLeases.mockResolvedValue({ rescheduled: 0, deadLettered: 0 })

    const deliverer: ChannelDeliverer = {
      channel: NotificationChannel.EMAIL,
      deliver: (context, admission) => deliver(context, admission),
    }
    service = buildService([deliverer])
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  /** Claims `claims` one at a time (one per lane claim), then reports an empty queue. */
  const queueClaims = (...claims: ClaimedDelivery[]): void => {
    for (const claim of claims) repository.claimDueBatch.mockResolvedValueOnce([claim])
    repository.claimDueBatch.mockResolvedValue([])
  }

  const drainOnce = async (claim: ClaimedDelivery): Promise<void> => {
    queueClaims(claim)
    await service.drainDueBatches()
  }

  describe('result mapping', () => {
    it('routes a delivered result to finalizeDelivered with provider id + duration', async () => {
      deliver.mockResolvedValue({ status: 'delivered', providerMessageId: 'prov-1' })
      await drainOnce(makeClaim('d1'))
      expect(repository.finalizeDelivered).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1' }),
        'prov-1',
        expect.any(Number)
      )
    })

    it('routes a transient result to finalizeTransient', async () => {
      deliver.mockResolvedValue({ status: 'transient', errorCode: 'provider_transient' })
      await drainOnce(makeClaim('d1'))
      expect(repository.finalizeTransient).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1' }),
        'provider_transient',
        expect.any(Number),
        undefined
      )
    })

    it('threads a provider retryAfterMs floor through to finalizeTransient', async () => {
      deliver.mockResolvedValue({
        status: 'transient',
        errorCode: 'telegram_rate_limited',
        retryAfterMs: 30_000,
      })
      await drainOnce(makeClaim('d1'))
      expect(repository.finalizeTransient).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1' }),
        'telegram_rate_limited',
        expect.any(Number),
        30_000
      )
    })

    it('routes a permanent result to finalizePermanent and emits one dead-letter signal', async () => {
      deliver.mockResolvedValue({ status: 'permanent', errorCode: 'provider_permanent' })
      await drainOnce(makeClaim('d1'))
      expect(repository.finalizePermanent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1' }),
        'provider_permanent',
        expect.any(Number)
      )
      expect(metrics.incQueueEvent).toHaveBeenCalledWith('notifications', 'dead_letter')
    })

    it('treats a thrown deliverer as transient (provider_error) and logs no error text', async () => {
      deliver.mockRejectedValue(new Error('SECRET provider text'))
      await drainOnce(makeClaim('d1'))
      expect(repository.finalizeTransient).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1' }),
        'provider_error',
        expect.any(Number),
        undefined
      )
      const logged = JSON.stringify(logger.warn.mock.calls)
      expect(logged).not.toContain('SECRET')
      expect(logged).not.toContain('Error')
    })

    it('does not finalize a refused (not_started) attempt and never assumes it settled', async () => {
      deliver.mockResolvedValue({ status: 'not_started', reason: 'lease_expired' })
      await drainOnce(makeClaim('d1'))
      expect(repository.finalizeDelivered).not.toHaveBeenCalled()
      expect(repository.finalizeTransient).not.toHaveBeenCalled()
      expect(repository.finalizePermanent).not.toHaveBeenCalled()
    })

    it('fails permanently with no_adapter (and dead-letters) when the channel has no deliverer', async () => {
      const noDelivererService = buildService([])
      queueClaims(makeClaim('d1'))
      await noDelivererService.drainDueBatches()
      expect(repository.finalizePermanent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1' }),
        'no_adapter',
        0
      )
      expect(deliver).not.toHaveBeenCalled()
      expect(metrics.incQueueEvent).toHaveBeenCalledWith('notifications', 'dead_letter')
    })

    it('fails permanently with notification_missing when the notification row is gone', async () => {
      prisma.notification.findUnique.mockResolvedValue(null)
      await drainOnce(makeClaim('d1'))
      expect(deliver).not.toHaveBeenCalled()
      expect(repository.finalizePermanent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'd1' }),
        'notification_missing',
        0
      )
    })

    it('runDispatchCycle reaps expired leases (emitting dead-letters) before draining', async () => {
      repository.reapExpiredLeases.mockResolvedValue({ rescheduled: 1, deadLettered: 2 })
      repository.claimDueBatch.mockResolvedValue([])
      await service.runDispatchCycle()
      expect(repository.reapExpiredLeases).toHaveBeenCalledTimes(1)
      expect(metrics.incQueueEvent).toHaveBeenCalledWith('notifications', 'dead_letter')
      expect(metrics.incQueueEvent).toHaveBeenCalledTimes(2) // one per dead-lettered row
    })
  })

  describe('capacity (lanes + shared gate)', () => {
    it('claims ONE row per lane and never exceeds the slot cap across overlapping drains', async () => {
      let active = 0
      let maxActive = 0
      const gates: Array<Deferred<void>> = []
      deliver.mockImplementation(async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        const gateDeferred = deferred<void>()
        gates.push(gateDeferred)
        await gateDeferred.promise
        active -= 1
        return { status: 'delivered' }
      })
      queueClaims(makeClaim('a'), makeClaim('b'), makeClaim('c'), makeClaim('d'))

      // wake + recovery + a direct entry all start together; only `capacity` lanes may run.
      const drains = [
        service.drainDueBatches(),
        service.runDispatchCycle(),
        service.drainDueBatches(),
      ]
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setImmediate(resolve))

      expect(maxActive).toBeLessThanOrEqual(2)
      // The waiting tail has NOT been claimed (no lease/attempt spent without capacity).
      expect(repository.claimDueBatch).toHaveBeenCalledTimes(2)
      expect(repository.claimDueBatch).toHaveBeenCalledWith(1)

      while (gates.length > 0 || active > 0) {
        gates.shift()?.resolve()
        await new Promise((resolve) => setImmediate(resolve))
      }
      await Promise.all(drains)
      expect(maxActive).toBeLessThanOrEqual(2)
      expect(repository.finalizeDelivered).toHaveBeenCalledTimes(4)
      expect(gate.free).toBe(2)
    })

    it('a full gate makes a new drain return at once and request a rescan', async () => {
      const hold = deferred<void>()
      deliver.mockImplementation(async () => {
        await hold.promise
        return { status: 'delivered' }
      })
      queueClaims(makeClaim('a'), makeClaim('b'))
      const first = service.drainDueBatches()
      await new Promise((resolve) => setImmediate(resolve))
      expect(gate.free).toBe(0)

      await service.drainDueBatches() // returns immediately, no claim
      expect(repository.claimDueBatch).toHaveBeenCalledTimes(2)
      hold.resolve()
      await first
      expect(gate.free).toBe(2)
    })

    it('a failing finalize does not detach siblings and still frees the slot', async () => {
      deliver.mockResolvedValue({ status: 'delivered' })
      repository.finalizeDelivered
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue({ state: 'delivered' })
      queueClaims(makeClaim('a'), makeClaim('b'))
      await service.drainDueBatches()
      expect(repository.finalizeDelivered).toHaveBeenCalledTimes(2)
      expect(gate.free).toBe(2)
    })
  })

  describe('timeout and physical settlement', () => {
    const slowTransport =
      (
        transport: Deferred<DeliveryResult>
      ): ((
        context: unknown,
        admission: DeliveryAdmission
      ) => Promise<DeliveryResult | NotStarted>) =>
      async (_context, admission) =>
        admission.send(() => transport.promise)

    it('times the attempt out as provider_timeout but keeps the slot until the transport settles', async () => {
      jest.useFakeTimers()
      const transport = deferred<DeliveryResult>()
      deliver.mockImplementation(slowTransport(transport))
      queueClaims(makeClaim('a'))

      const drain = service.drainDueBatches()
      await jest.advanceTimersByTimeAsync(NOTIFICATION_PROVIDER_TIMEOUT_MS)
      await drain

      expect(repository.finalizeTransient).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a' }),
        'provider_timeout',
        expect.any(Number),
        undefined
      )
      // The wake work is done, yet the physical call is still pending: the slot is NOT freed.
      expect(gate.free).toBe(1)

      transport.resolve({ status: 'delivered' }) // late result is discarded
      await jest.advanceTimersByTimeAsync(0)
      expect(gate.free).toBe(2)
      expect(repository.finalizeDelivered).not.toHaveBeenCalled()
    })

    it('also frees the slot when the late transport REJECTS (no unhandled rejection)', async () => {
      jest.useFakeTimers()
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      try {
        const transport = deferred<DeliveryResult>()
        deliver.mockImplementation(slowTransport(transport))
        queueClaims(makeClaim('a'))
        const drain = service.drainDueBatches()
        await jest.advanceTimersByTimeAsync(NOTIFICATION_PROVIDER_TIMEOUT_MS)
        await drain
        expect(gate.free).toBe(1)

        transport.reject(new Error('socket reset'))
        await jest.advanceTimersByTimeAsync(0)
        expect(gate.free).toBe(2)
        expect(unhandled).not.toHaveBeenCalled()
      } finally {
        process.off('unhandledRejection', unhandled)
      }
    })

    it('keeps the reservation when timeout finalization REJECTS while the call is pending', async () => {
      jest.useFakeTimers()
      const transport = deferred<DeliveryResult>()
      deliver.mockImplementation(slowTransport(transport))
      repository.finalizeTransient.mockRejectedValue(new Error('db down'))
      queueClaims(makeClaim('a'))

      const drain = service.drainDueBatches()
      await jest.advanceTimersByTimeAsync(NOTIFICATION_PROVIDER_TIMEOUT_MS)
      await drain

      expect(gate.free).toBe(1) // not freed by the failed finalize
      transport.resolve({ status: 'delivered' })
      await jest.advanceTimersByTimeAsync(0)
      expect(gate.free).toBe(2)
    })
  })

  describe('shutdown (latch)', () => {
    afterEach(() => jest.useRealTimers())

    it('registers a bounded barrier before the database teardown', () => {
      service.onModuleInit()
      expect(prisma.registerShutdownBarrier).toHaveBeenCalledTimes(1)
    })

    it('seals BEFORE returning when nothing is active (early/empty completion)', async () => {
      await service.shutdown()
      expect(latch.closed).toBe(true)
      expect(latch.sealed).toBe(true)
    })

    it('is idempotent: repeated shutdowns return the same promise and never extend the deadline', () => {
      jest.useFakeTimers()
      repository.claimDueBatch.mockImplementation(() => new Promise(() => undefined))
      void service.drainDueBatches()
      const first = service.shutdown()
      const second = service.shutdown()
      expect(second).toBe(first)
      service.onModuleDestroy()
      expect(service.shutdown()).toBe(first)
    })

    it('releases a PENDING FINALIZE at the cutoff: shutdown, drain and later work stay bounded', async () => {
      jest.useFakeTimers()
      deliver.mockResolvedValue({ status: 'delivered' })
      const finalize = deferred<{ state: 'delivered' }>()
      repository.finalizeDelivered.mockReturnValue(finalize.promise)
      queueClaims(makeClaim('a'))

      const drain = service.drainDueBatches()
      await jest.advanceTimersByTimeAsync(0)
      const shutdown = service.shutdown()
      await jest.advanceTimersByTimeAsync(NOTIFICATION_SHUTDOWN_GRACE_MS)
      await Promise.all([shutdown, drain])

      expect(latch.sealed).toBe(true)
      // A late resolve changes nothing and starts no new work.
      const claimsBefore = repository.claimDueBatch.mock.calls.length
      finalize.resolve({ state: 'delivered' })
      await jest.advanceTimersByTimeAsync(0)
      expect(repository.claimDueBatch).toHaveBeenCalledTimes(claimsBefore)
    })

    it('releases a PENDING CLAIM and a PENDING NOTIFICATION LOAD at the cutoff', async () => {
      jest.useFakeTimers()
      const claim = deferred<ClaimedDelivery[]>()
      repository.claimDueBatch.mockReturnValueOnce(claim.promise)
      const drain = service.drainDueBatches()
      const shutdown = service.shutdown()
      await jest.advanceTimersByTimeAsync(NOTIFICATION_SHUTDOWN_GRACE_MS)
      await Promise.all([shutdown, drain])
      claim.resolve([makeClaim('late')])
      await jest.advanceTimersByTimeAsync(0)
      expect(prisma.notification.findUnique).not.toHaveBeenCalled()
      expect(deliver).not.toHaveBeenCalled()
    })

    it('releases a pending notification LOAD', async () => {
      jest.useFakeTimers()
      const load = deferred<null>()
      prisma.notification.findUnique.mockReturnValue(load.promise as never)
      queueClaims(makeClaim('a'))
      const drain = service.drainDueBatches()
      await jest.advanceTimersByTimeAsync(0)
      const shutdown = service.shutdown()
      await jest.advanceTimersByTimeAsync(NOTIFICATION_SHUTDOWN_GRACE_MS)
      await Promise.all([shutdown, drain])
      load.resolve(null)
      await jest.advanceTimersByTimeAsync(0)
      expect(repository.finalizePermanent).not.toHaveBeenCalled() // late "missing" starts no DB work
    })

    it('guards recovery entry: after close the reaper, claim, load and admission are never invoked', async () => {
      service.onModuleDestroy() // closed
      await service.runDispatchCycle()
      await service.reapExpiredLeases()
      await service.drainDueBatches()
      expect(repository.reapExpiredLeases).not.toHaveBeenCalled()
      expect(repository.claimDueBatch).not.toHaveBeenCalled()
      expect(prisma.notification.findUnique).not.toHaveBeenCalled()
      expect(deliver).not.toHaveBeenCalled()
    })

    it('releases a pending reaper pass inside runDispatchCycle at the cutoff', async () => {
      jest.useFakeTimers()
      repository.reapExpiredLeases.mockReturnValue(new Promise(() => undefined))
      // The repository wraps its transaction in the latch; emulate by sealing while pending.
      const cycle = service.runDispatchCycle()
      const shutdown = service.shutdown()
      await jest.advanceTimersByTimeAsync(NOTIFICATION_SHUTDOWN_GRACE_MS)
      await shutdown
      // The repository itself returns CUTOFF once sealed; the cycle must not hang on a second step.
      expect(latch.sealed).toBe(true)
      void cycle
    })

    it('early shutdown with a PENDING transport: late permanent result starts no DB/fence work', async () => {
      jest.useFakeTimers()
      const transport = deferred<DeliveryResult>()
      const afterTransport = jest.fn()
      deliver.mockImplementation(async (_context, admission) => {
        const result = await admission.send(() => transport.promise)
        // What a deliverer does after a permanent destination error: DB work via the latch.
        await latch.run(async () => afterTransport())
        return result as DeliveryResult
      })
      queueClaims(makeClaim('a'))
      const drain = service.drainDueBatches()
      await jest.advanceTimersByTimeAsync(NOTIFICATION_PROVIDER_TIMEOUT_MS)
      await drain // attempt timed out; reservation handed to the settlement tracker

      await service.shutdown() // nothing active: seals immediately, before returning
      expect(latch.sealed).toBe(true)

      transport.resolve({ status: 'permanent', errorCode: 'telegram_forbidden' })
      await jest.advanceTimersByTimeAsync(0)
      expect(afterTransport).not.toHaveBeenCalled()
      expect(gate.free).toBe(2)
    })
  })
  it('performs no PG recovery/claim or transport before shared startup readiness', async () => {
    const service = buildService([], 2, false)
    await service.runDispatchCycle()
    await service.reapExpiredLeases()
    await service.drainDueBatches()
    expect(repository.reapExpiredLeases).not.toHaveBeenCalled()
    expect(repository.claimDueBatch).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
  })
})
