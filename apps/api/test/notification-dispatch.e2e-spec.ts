import type { INestApplication } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'

import { NotificationDeliveryRepository } from '../src/core/notifications/dispatch/notification-delivery.repository'
import { NotificationDispatchService } from '../src/core/notifications/dispatch/notification-dispatch.service'
import { NotificationChannel } from '../src/core/notifications/notification.constants'
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
    const [a, b] = await Promise.all([repository.claimDueBatch(3), repository.claimDueBatch(3)])

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

    const [claim] = await repository.claimDueBatch(1)
    expect(claim!.id).toBe(deliveryId)

    // Force the lease to look expired, then reap it: RETRY_SCHEDULED + attempt ABANDONED.
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    })
    const reaped = await repository.reapExpiredLeases()
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
    const [transientClaim] = await repository.claimDueBatch(1)
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
    const claims = await repository.claimDueBatch(10)
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
    const exhaustedClaims = await repository.claimDueBatch(10)
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

  it('reaps an expired lease to FAILED when the retry budget is exhausted', async () => {
    const userId = await createUser()
    const notificationId = await createNotification(userId)
    const deliveryId = await createDelivery(notificationId, { maxAttempts: 1 })

    await repository.claimDueBatch(1) // attemptNumber → 1 (== maxAttempts)
    await prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    })

    const reaped = await repository.reapExpiredLeases()
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

    const claimed = await repository.claimDueBatch(10)
    expect(claimed).toHaveLength(2)
    // One token for the batch (CAS keys on (id, leaseToken), not token uniqueness).
    expect(new Set(claimed.map((c) => c.leaseToken)).size).toBe(1)
    expect(claimed[0]!.leaseToken).toBeTruthy()
  })
})
