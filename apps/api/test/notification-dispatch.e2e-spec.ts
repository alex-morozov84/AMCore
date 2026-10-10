import { jest } from '@jest/globals'
import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'

import { ChannelDelivererRegistry } from '../src/core/notifications/channels/channel-deliverer.registry'
import { EmailChannelDeliverer } from '../src/core/notifications/channels/email-channel.deliverer'
import { NotificationChannelRegistry } from '../src/core/notifications/channels/notification-channel.registry'
import { NotificationAttemptAdmission } from '../src/core/notifications/dispatch/notification-attempt-admission'
import { NotificationDeliveryRepository } from '../src/core/notifications/dispatch/notification-delivery.repository'
import { NotificationDispatchGate } from '../src/core/notifications/dispatch/notification-dispatch.gate'
import { NotificationDispatchService } from '../src/core/notifications/dispatch/notification-dispatch.service'
import type {
  ClaimedDelivery,
  ReapResult,
} from '../src/core/notifications/dispatch/notification-dispatch.types'
import { NotificationPreparedRequestService } from '../src/core/notifications/dispatch/notification-prepared-request.service'
import {
  CUTOFF,
  NotificationShutdownLatch,
} from '../src/core/notifications/dispatch/notification-shutdown.latch'
import { NotificationChannel } from '../src/core/notifications/notification.constants'
import { NotificationDefinitionRegistry } from '../src/core/notifications/notification-definition.registry'
import { EnvService } from '../src/env/env.service'
import { WorkReadiness } from '../src/infrastructure/background-work/work-readiness'
import { EmailService } from '../src/infrastructure/email/email.service'
import { ResendEmailProvider } from '../src/infrastructure/email/providers/resend.provider'
import { MetricsService } from '../src/infrastructure/observability'
import { QueueService } from '../src/infrastructure/queue/queue.service'
import type { PrismaService } from '../src/prisma'

import { cleanDatabase, type E2ETestContext, setupE2ETest, teardownE2ETest } from './helpers'

import { NotificationAttemptOutcome, NotificationDeliveryStatus } from '@/generated/prisma/client'

/**
 * Arc B merge gate (ADR-052) — the durable-dispatcher proofs that the unit specs cannot
 * give because they mock Prisma: the raw `FOR UPDATE SKIP LOCKED` claim, the lease/CAS
 * finalize, and the expired-lease reaper, all against real Postgres. The background
 * recovery `@Cron` is stopped in `beforeAll` so each test deterministically drives the
 * dispatcher itself (the cron's behavior is covered by `notifications.e2e-spec` /
 * `process-role.e2e-spec`).
 */
describe('Notification dispatch (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext
  let repository: NotificationDeliveryRepository
  let dispatch: NotificationDispatchService

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    repository = app.get(NotificationDeliveryRepository, { strict: false })
    dispatch = app.get(NotificationDispatchService, { strict: false })
    // Stop every scheduled cron (recovery/retention/cleanup) so the dispatcher only runs
    // when a test invokes it — no background drain races these DB-level assertions.
    const scheduler = app.get(SchedulerRegistry, { strict: false })
    for (const job of scheduler.getCronJobs().values()) job.stop()
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })

  /** The repository returns CUTOFF only after a shutdown seal, which these tests never perform. */
  async function claimBatch(limit: number): Promise<ClaimedDelivery[]> {
    const claimed = await repository.claimDueBatch(limit)
    if (claimed === CUTOFF) throw new Error('unexpected cutoff')
    return claimed
  }
  async function reap(): Promise<ReapResult> {
    const reaped = await repository.reapExpiredLeases()
    if (reaped === CUTOFF) throw new Error('unexpected cutoff')
    return reaped
  }

  let seq = 0
  async function createUser(): Promise<string> {
    seq += 1
    const user = await prisma.user.create({
      data: {
        email: `dispatch-${Date.now()}-${seq}@example.com`,
        emailCanonical: `dispatch-${Date.now()}-${seq}@example.com`,
        passwordHash: 'x',
      },
      select: { id: true },
    })
    return user.id
  }

  async function createNotification(userId: string): Promise<string> {
    seq += 1
    const row = await prisma.notification.create({
      data: {
        recipientUserId: userId,
        type: 'account.profile_updated',
        category: 'account',
        schemaVersion: 1,
        payload: { updatedFields: ['name'] },
        idempotencyKey: `account.profile_updated:dispatch-${Date.now()}-${seq}`,
        idempotencyFingerprint: `fp-${Date.now()}-${seq}`,
        occurredAt: new Date(),
      },
      select: { id: true },
    })
    return row.id
  }

  async function createDelivery(
    notificationId: string,
    opts: { maxAttempts?: number; availableAt?: Date } = {}
  ): Promise<string> {
    seq += 1
    const row = await prisma.notificationDelivery.create({
      data: {
        notificationId,
        requestContractVersion: 1,
        channel: NotificationChannel.EMAIL,
        targetKey: `dispatch-${Date.now()}-${seq}@example.com`,
        locale: 'en',
        status: NotificationDeliveryStatus.PENDING,
        maxAttempts: opts.maxAttempts ?? 5,
        ...(opts.availableAt ? { availableAt: opts.availableAt } : {}),
      },
      select: { id: true },
    })
    return row.id
  }

  it('claims due deliveries under FOR UPDATE SKIP LOCKED without double-claiming', async () => {
    const userId = await createUser()
    const notificationId = await createNotification(userId)
    const ids = await Promise.all(Array.from({ length: 6 }, () => createDelivery(notificationId)))

    // Two concurrent claimers, each bounded to 3 — SKIP LOCKED must hand them disjoint rows.
    const [a, b] = await Promise.all([claimBatch(3), claimBatch(3)])

    const claimedA = a.map((c) => c.id)
    const claimedB = b.map((c) => c.id)
    const overlap = claimedA.filter((id) => claimedB.includes(id))
    expect(overlap).toEqual([])
    expect(new Set([...claimedA, ...claimedB])).toEqual(new Set(ids))

    // Every claimed row is now PROCESSING with exactly one in-flight attempt.
    const processing = await prisma.notificationDelivery.findMany({
      where: { id: { in: ids }, status: NotificationDeliveryStatus.PROCESSING },
    })
    expect(processing).toHaveLength(6)
    const attempts = await prisma.notificationDeliveryAttempt.count({
      where: { deliveryId: { in: ids } },
    })
    expect(attempts).toBe(6)
  })

  it('rejects a stale lease holder via CAS after the lease is reaped', async () => {
    const userId = await createUser()
    const notificationId = await createNotification(userId)
    const deliveryId = await createDelivery(notificationId)

    const [claim] = await claimBatch(1)
    expect(claim!.id).toBe(deliveryId)

    // Force the lease to look expired, then reap it: RETRY_SCHEDULED + attempt ABANDONED.
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    })
    const reaped = await reap()
    expect(reaped.rescheduled).toBe(1)

    const afterReap = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    })
    expect(afterReap.status).toBe(NotificationDeliveryStatus.RETRY_SCHEDULED)
    expect(afterReap.nextAttemptAt).toBeInstanceOf(Date)
    expect(afterReap.leaseToken).toBeNull()
    const abandoned = await prisma.notificationDeliveryAttempt.findFirstOrThrow({
      where: { deliveryId },
    })
    expect(abandoned.outcome).toBe(NotificationAttemptOutcome.ABANDONED)

    // The original holder now tries to commit success — its CAS must match 0 rows.
    const finalize = await repository.finalizeDelivered(claim!, 'provider-msg', 5)
    expect(finalize.state).toBe('lease_lost')

    // State is unchanged by the stale holder — still the reaper's RETRY_SCHEDULED.
    const afterStale = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    })
    expect(afterStale.status).toBe(NotificationDeliveryStatus.RETRY_SCHEDULED)
    expect(afterStale.deliveredAt).toBeNull()
  })

  it('persists transient, permanent, and exhausted attempt history', async () => {
    const userId = await createUser()
    const notificationId = await createNotification(userId)

    // Transient with budget left → RETRY_SCHEDULED + TRANSIENT_FAILURE attempt.
    const transientId = await createDelivery(notificationId)
    const [transientClaim] = await claimBatch(1)
    const transient = await repository.finalizeTransient(
      transientClaim!,
      'email_provider_transient',
      5
    )
    expect(transient.state).toBe('retry_scheduled')
    const transientRow = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: transientId },
    })
    expect(transientRow.status).toBe(NotificationDeliveryStatus.RETRY_SCHEDULED)
    const transientAttempt = await prisma.notificationDeliveryAttempt.findFirstOrThrow({
      where: { deliveryId: transientId },
    })
    expect(transientAttempt.outcome).toBe(NotificationAttemptOutcome.TRANSIENT_FAILURE)
    expect(transientAttempt.finishedAt).toBeInstanceOf(Date)

    // Permanent → FAILED + PERMANENT_FAILURE attempt, dead-lettered.
    const permanentId = await createDelivery(notificationId, { availableAt: new Date() })
    const claims = await claimBatch(10)
    const permanentClaim = claims.find((c) => c.id === permanentId)!
    const permanent = await repository.finalizePermanent(
      permanentClaim,
      'email_provider_permanent',
      5
    )
    expect(permanent).toEqual({
      state: 'failed',
      reasonCode: 'permanent_failure',
      deadLettered: true,
    })
    const permanentRow = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: permanentId },
    })
    expect(permanentRow.status).toBe(NotificationDeliveryStatus.FAILED)

    // Exhausted: maxAttempts=1 → the first transient failure is terminal + dead-lettered.
    const exhaustedId = await createDelivery(notificationId, {
      maxAttempts: 1,
      availableAt: new Date(),
    })
    const exhaustedClaims = await claimBatch(10)
    const exhaustedClaim = exhaustedClaims.find((c) => c.id === exhaustedId)!
    const exhausted = await repository.finalizeTransient(
      exhaustedClaim,
      'email_provider_transient',
      5
    )
    expect(exhausted).toEqual({
      state: 'failed',
      reasonCode: 'attempts_exhausted',
      deadLettered: true,
    })
    const exhaustedRow = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: exhaustedId },
    })
    expect(exhaustedRow.status).toBe(NotificationDeliveryStatus.FAILED)
    expect(exhaustedRow.terminalReasonCode).toBe('attempts_exhausted')
  })

  it('drains a committed delivery whose wake was never enqueued (recovery poller path)', async () => {
    const userId = await createUser()
    const notificationId = await createNotification(userId)
    // Committed PENDING delivery, no BullMQ wake — exactly the lost-wake / notifyTx case.
    const deliveryId = await createDelivery(notificationId)

    await dispatch.runDispatchCycle()

    // The poller claimed and processed it without any wake job: it left PENDING and has
    // an attempt recorded (terminal state depends on the configured email provider).
    const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
    expect(row.status).not.toBe(NotificationDeliveryStatus.PENDING)
    expect(row.attemptCount).toBeGreaterThanOrEqual(1)
    const attempts = await prisma.notificationDeliveryAttempt.count({ where: { deliveryId } })
    expect(attempts).toBeGreaterThanOrEqual(1)
  })

  it('persists real-SDK Retry-After through rendering, email admission and dispatch without enqueueing', async () => {
    const userId = await createUser()
    const deliveryId = await createDelivery(await createNotification(userId))
    const env = app.get(EnvService)
    const logger = app.get<PinoLogger>(PinoLogger, { strict: false })
    const metrics = app.get(MetricsService)
    const queue = app.get(QueueService)
    const provider = new ResendEmailProvider(
      {
        get: (key: string) =>
          key === 'RESEND_API_KEY' ? 're_test_contract' : env.get('EMAIL_FROM'),
      } as EnvService,
      logger
    )
    const email = new EmailService(provider, queue, env, logger, metrics)
    const latch = new NotificationShutdownLatch(logger)
    const adapter = new EmailChannelDeliverer(
      app.get(NotificationDefinitionRegistry),
      email,
      env,
      new NotificationPreparedRequestService(prisma, app.get(NotificationChannelRegistry), latch)
    )
    const localRepository = new NotificationDeliveryRepository(prisma, latch)
    const service = new NotificationDispatchService(
      prisma,
      localRepository,
      new ChannelDelivererRegistry([adapter]),
      metrics,
      logger,
      latch,
      new NotificationDispatchGate(latch),
      new NotificationAttemptAdmission(prisma, latch),
      app.get(WorkReadiness, { strict: false })
    )
    const enqueue = jest.spyOn(queue, 'add')
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ name: 'rate_limit_exceeded', message: 'contract sentinel' }),
          { status: 429, headers: { 'retry-after': '600', 'content-type': 'application/json' } }
        )
      )
    try {
      const before = Date.now()
      await service.drainDueBatches()
      const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
      expect(row.status).toBe(NotificationDeliveryStatus.RETRY_SCHEDULED)
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before + 600_000)
      expect(row.nextAttemptAt!.getTime()).toBeLessThanOrEqual(Date.now() + 600_000)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal)
      expect(enqueue).not.toHaveBeenCalled()
      expect(await localRepository.claimDueBatch(1)).toEqual([])
      // Move the stored floor to the due boundary; the same claim query can now acquire it.
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { nextAttemptAt: new Date(Date.now() - 1) },
      })
      expect(await localRepository.claimDueBatch(1)).toHaveLength(1)
    } finally {
      fetch.mockRestore()
      enqueue.mockRestore()
      await service.shutdown()
    }
  })

  it('reaps an expired lease to FAILED when the retry budget is exhausted', async () => {
    const userId = await createUser()
    const notificationId = await createNotification(userId)
    const deliveryId = await createDelivery(notificationId, { maxAttempts: 1 })

    await claimBatch(1) // attemptNumber → 1 (== maxAttempts)
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    })

    const reaped = await reap()
    expect(reaped.deadLettered).toBe(1)
    expect(reaped.rescheduled).toBe(0)

    const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
    expect(row.status).toBe(NotificationDeliveryStatus.FAILED)
    expect(row.terminalReasonCode).toBe('attempts_exhausted')
    const attempt = await prisma.notificationDeliveryAttempt.findFirstOrThrow({
      where: { deliveryId },
    })
    expect(attempt.outcome).toBe(NotificationAttemptOutcome.ABANDONED)
  })

  it('uses a distinct lease token per claim batch', async () => {
    const userId = await createUser()
    const notificationId = await createNotification(userId)
    await createDelivery(notificationId)
    await createDelivery(notificationId)

    const claimed = await claimBatch(10)
    expect(claimed).toHaveLength(2)
    // One token for the batch (CAS keys on (id, leaseToken), not token uniqueness).
    expect(new Set(claimed.map((c) => c.leaseToken)).size).toBe(1)
    expect(claimed[0]!.leaseToken).toBeTruthy()
  })

  it('gives every single-row claim its own lease token (the dispatcher claims one row per lane)', async () => {
    const userId = await createUser()
    const notificationId = await createNotification(userId)
    await createDelivery(notificationId)
    await createDelivery(notificationId)

    const [first] = await claimBatch(1)
    const [second] = await claimBatch(1)
    expect(first!.leaseToken).not.toBe(second!.leaseToken)
  })

  it('derives the claim lease expiry from Postgres time, not the worker clock (R1)', async () => {
    const userId = await createUser()
    const notificationId = await createNotification(userId)
    const deliveryId = await createDelivery(notificationId)

    // Skew ONLY the Node `Date` by +1 h: a Node-derived lease would land an hour late.
    jest.useFakeTimers({
      now: new Date(Date.now() + 3_600_000),
      doNotFake: [
        'nextTick',
        'setImmediate',
        'setTimeout',
        'setInterval',
        'clearTimeout',
        'clearInterval',
        'queueMicrotask',
        'performance',
        'hrtime',
      ],
    })
    try {
      await claimBatch(1)
    } finally {
      jest.useRealTimers()
    }

    const [row] = await prisma.$queryRaw<{ remainingMs: number }[]>`
      SELECT (EXTRACT(EPOCH FROM ("leaseExpiresAt" - clock_timestamp())) * 1000)::float8 AS "remainingMs"
      FROM "notifications"."notification_deliveries" WHERE id = ${deliveryId}`
    // ~2 min lease from the DB clock (a skewed Node clock would give ~62 min).
    expect(row!.remainingMs).toBeGreaterThan(110_000)
    expect(row!.remainingMs).toBeLessThanOrEqual(120_000)
    // (The attempt's `startedAt` is history stamped by Prisma with the process clock; only the
    // lease expiry is lease-validity state and therefore database-derived.)
  })

  describe('exhausted cooldown and Retry-After (ADR-052 24 h clamp kept)', () => {
    async function exhaust(retryAfterMs?: number) {
      const userId = await createUser()
      const notificationId = await createNotification(userId)
      const deliveryId = await createDelivery(notificationId, { maxAttempts: 1 })
      const [claim] = await claimBatch(1)
      const before = Date.now()
      const result = await repository.finalizeTransient(claim!, 'p_transient', 5, retryAfterMs)
      const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
      return { result, row, before, deliveryId }
    }

    it('retains the provider floor on the terminal FAILED row (earliest permitted next attempt)', async () => {
      const { result, row, before } = await exhaust(5 * 60_000)
      expect(result).toMatchObject({ state: 'failed', reasonCode: 'attempts_exhausted' })
      expect(row.status).toBe(NotificationDeliveryStatus.FAILED)
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before + 5 * 60_000 - 1_000)
      expect(row.nextAttemptAt!.getTime()).toBeLessThan(before + 5 * 60_000 + 30_000)
    })

    it('clamps a valid 48 h request to 24 h — the accepted exception, asserted explicitly', async () => {
      const { row, before } = await exhaust(48 * 3_600_000)
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before + 24 * 3_600_000 - 1_000)
      expect(row.nextAttemptAt!.getTime()).toBeLessThan(before + 24 * 3_600_000 + 30_000)
    })

    it('leaves no stale due timestamp when the transport gave no floor', async () => {
      const { row } = await exhaust(undefined)
      expect(row.nextAttemptAt).toBeNull()
    })

    it('never claims a FAILED row, whatever its retained nextAttemptAt says', async () => {
      const { deliveryId } = await exhaust(1_000)
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { nextAttemptAt: new Date(Date.now() - 60_000) }, // due, but FAILED
      })
      expect(await claimBatch(10)).toEqual([])
    })

    it('schedules a retry no earlier than the floor, and a stale finalize cannot change a retained floor', async () => {
      const userId = await createUser()
      const notificationId = await createNotification(userId)
      const deliveryId = await createDelivery(notificationId)
      const [claim] = await claimBatch(1)
      const before = Date.now()
      const retry = await repository.finalizeTransient(claim!, 'p_transient', 5, 10 * 60_000)
      expect(retry.state).toBe('retry_scheduled')
      const scheduled = await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
      })
      expect(scheduled.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(
        before + 10 * 60_000 - 1_000
      )
      // Just before the floor nothing is claimable; at/after it the row is.
      expect(await claimBatch(10)).toEqual([])
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { nextAttemptAt: new Date(Date.now() - 1) },
      })
      expect(await claimBatch(10)).toHaveLength(1)

      // A stale holder (the first claim's token) cannot overwrite the new attempt.
      const stale = await repository.finalizeTransient(claim!, 'p_transient', 5, 60 * 60_000)
      expect(stale.state).toBe('lease_lost')
    })
  })

  describe('actual-start admission (real Postgres)', () => {
    let admission: NotificationAttemptAdmission

    beforeAll(() => {
      admission = app.get(NotificationAttemptAdmission, { strict: false })
    })

    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

    async function claimOne(): Promise<{
      claim: ClaimedDelivery
      deliveryId: string
      userId: string
    }> {
      const userId = await createUser()
      const notificationId = await createNotification(userId)
      const deliveryId = await createDelivery(notificationId)
      const [claim] = await claimBatch(1)
      return { claim: claim!, deliveryId, userId }
    }

    function open(claim: ClaimedDelivery, userId: string, checkTarget?: unknown) {
      const controller = new AbortController()
      const started: Promise<unknown>[] = []
      const send = jest.fn(async (_signal: AbortSignal) => 'sent')
      const deliverer = { channel: NotificationChannel.EMAIL, deliver: jest.fn(), checkTarget }
      const admissionFor = admission.create(
        {
          delivery: claim,
          notification: { id: claim.notificationId, recipientUserId: userId } as never,
        },
        deliverer as never,
        { signal: controller.signal, onTransportStarted: (p) => started.push(p) }
      )
      return { controller, send, started, admissionFor }
    }

    /** Hold `FOR UPDATE` on the delivery row from a second connection for `holdMs`. */
    function holdRowLock(deliveryId: string, holdMs: number): Promise<void> {
      return prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "notifications"."notification_deliveries" WHERE id = ${deliveryId} FOR UPDATE`
          await sleep(holdMs)
        },
        { timeout: holdMs + 10_000 }
      )
    }

    it('admits a live lease: renews it with fresh DB time and invokes the transport exactly once', async () => {
      const { claim, deliveryId, userId } = await claimOne()
      const before = await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
      })
      await sleep(20)
      const { admissionFor, send, started } = open(claim, userId)

      const result = await admissionFor.send(send)

      expect(result).toBe('sent')
      expect(send).toHaveBeenCalledTimes(1)
      expect(started).toHaveLength(1)
      const after = await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
      })
      expect(after.leaseExpiresAt!.getTime()).toBeGreaterThan(before.leaseExpiresAt!.getTime())
      // One-shot: the admission cannot authorize a second call.
      await expect(admissionFor.send(send)).rejects.toThrow('delivery_admission_already_used')
    })

    it('a reaped + reclaimed old holder makes ZERO transport calls and cannot touch the new attempt', async () => {
      const { claim, deliveryId, userId } = await claimOne()
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
      })
      await reap() // → RETRY_SCHEDULED, old attempt ABANDONED
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { nextAttemptAt: new Date(Date.now() - 1) },
      })
      const [newClaim] = await claimBatch(1) // a NEW holder, new lease token, attempt 2
      expect(newClaim!.attemptNumber).toBe(2)

      const { admissionFor, send } = open(claim, userId)
      const result = await admissionFor.send(send)

      expect(result).toEqual({ status: 'not_started', reason: 'lease_lost' })
      expect(send).not.toHaveBeenCalled()
      // Late finalize by the stale holder cannot corrupt the new attempt either.
      expect((await repository.finalizeDelivered(claim, 'late', 1)).state).toBe('lease_lost')
      const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
      expect(row.status).toBe(NotificationDeliveryStatus.PROCESSING)
      expect(row.leaseToken).toBe(newClaim!.leaseToken)
      expect(row.attemptCount).toBe(2)
    })

    it('refuses an expired-but-unreaped lease; the row stays PROCESSING until the reaper marks it', async () => {
      const { claim, deliveryId, userId } = await claimOne()
      await prisma.notificationDelivery.update({
        where: { id: deliveryId },
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
      })
      const { admissionFor, send } = open(claim, userId)

      const result = await admissionFor.send(send)

      expect(result).toEqual({ status: 'not_started', reason: 'lease_expired' })
      expect(send).not.toHaveBeenCalled()
      const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
      expect(row.status).toBe(NotificationDeliveryStatus.PROCESSING) // NOT assumed settled
      const attempt = await prisma.notificationDeliveryAttempt.findFirstOrThrow({
        where: { deliveryId },
      })
      expect(attempt.outcome).toBeNull()
      expect((await reap()).rescheduled).toBe(1) // recovered by lease expiry → reaper
    })

    it('a lock wait that crosses the lease expiry is refused by the FRESH database clock', async () => {
      const { claim, deliveryId, userId } = await claimOne()
      // Lease valid for only ~400 ms from the DB clock.
      await prisma.$executeRaw`UPDATE "notifications"."notification_deliveries"
        SET "leaseExpiresAt" = clock_timestamp() + interval '400 milliseconds' WHERE id = ${deliveryId}`
      const { admissionFor, send } = open(claim, userId)

      const holder = holdRowLock(deliveryId, 900) // another connection holds the row lock past expiry
      await sleep(100)
      const result = await admissionFor.send(send) // blocks on the lock, then must NOT be admitted
      await holder

      expect(result).toEqual({ status: 'not_started', reason: 'lease_expired' })
      expect(send).not.toHaveBeenCalled()
    })

    it('an abort that arrives while admission waits on a lock means ZERO transport calls', async () => {
      const { claim, deliveryId, userId } = await claimOne()
      const { admissionFor, send, controller } = open(claim, userId)

      const holder = holdRowLock(deliveryId, 600)
      await sleep(100)
      const pending = admissionFor.send(send) // blocked on the delivery row lock
      await sleep(50)
      controller.abort() // the attempt timed out while admission was waiting
      const result = await pending
      await holder

      expect(result).toEqual({ status: 'not_started', reason: 'aborted' })
      expect(send).not.toHaveBeenCalled()
    })

    it('fails CLOSED when the lock cannot be acquired within the lock timeout (no transport call)', async () => {
      const { claim, deliveryId, userId } = await claimOne()
      const { admissionFor, send } = open(claim, userId)

      const holder = holdRowLock(deliveryId, 3_500)
      await sleep(100)
      await expect(admissionFor.send(send)).rejects.toThrow()
      await holder

      expect(send).not.toHaveBeenCalled()
    }, 30000)

    it('cancels the delivery and its attempt when the channel target check refuses (no call)', async () => {
      const { claim, deliveryId, userId } = await claimOne()
      const { admissionFor, send } = open(claim, userId, async () => ({
        reason: 'test_target_revoked',
      }))

      const result = await admissionFor.send(send)

      expect(result).toEqual({ status: 'not_started', reason: 'target_revoked' })
      expect(send).not.toHaveBeenCalled()
      const row = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
      expect(row.status).toBe(NotificationDeliveryStatus.CANCELLED)
      expect(row.terminalReasonCode).toBe('test_target_revoked')
      expect(row.leaseToken).toBeNull()
      const attempt = await prisma.notificationDeliveryAttempt.findFirstOrThrow({
        where: { deliveryId },
      })
      expect(attempt.outcome).toBe(NotificationAttemptOutcome.ABANDONED)
      expect(attempt.errorCode).toBe('target_revoked')
    })
  })
})
