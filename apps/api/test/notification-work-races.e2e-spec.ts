import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { v7 as uuidv7 } from 'uuid'

import { SystemRole, type WorkCommand } from '@amcore/shared'

import type { NotificationControlTargets } from '../src/core/notifications/channels/notification-control-targets'
import {
  deliveryRevision,
  notificationWorkDigest,
} from '../src/core/notifications/control/notification-control-policy'
import { NotificationWorkControl } from '../src/core/notifications/control/notification-work-control'
import { NotificationWorkReader } from '../src/core/notifications/control/notification-work-reader'
import { NotificationDeliveryRepository } from '../src/core/notifications/dispatch/notification-delivery.repository'
import { cancelActiveDeliveries } from '../src/core/notifications/dispatch/notification-delivery-cancellation'
import { markNotificationTransport } from '../src/core/notifications/dispatch/notification-effect-evidence'
import {
  CUTOFF,
  NotificationShutdownLatch,
} from '../src/core/notifications/dispatch/notification-shutdown.latch'
import { NotificationRetentionService } from '../src/core/notifications/notification-retention.service'
import {
  type NotificationDelivery,
  type Prisma,
  PrismaClient,
} from '../src/generated/prisma/client'
import type { SingletonCronRunner } from '../src/infrastructure/schedule/singleton-cron.runner'
import type { PrismaService } from '../src/prisma'

import { e2eContainerLabels } from './e2e-owned-containers'
import {
  deferred,
  transactionBarrier,
  waitForBlocked,
  waitForDatabaseTime,
} from './fixtures/notification-work/barriers'
import { migrateTestDatabase, noopPinoLogger } from './helpers'

const old = new Date(Date.now() - 45 * 86400000)

describe('Notification real PostgreSQL interleavings', () => {
  let container: StartedPostgreSqlContainer
  let db: PrismaClient
  let user: string
  let sequence = 0
  const control = new NotificationWorkControl({
    validate: async () => null,
  } as unknown as NotificationControlTargets)
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    await migrateTestDatabase(container.getConnectionUri())
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: container.getConnectionUri() }),
    })
    await db.$connect()
    user = (
      await db.user.create({
        data: { email: 'race@example.test', emailCanonical: 'race@example.test' },
      })
    ).id
  }, 120000)
  afterAll(async () => {
    await db?.$disconnect()
    await container?.stop()
  }, 60000)
  beforeEach(async () => {
    await db.notification.deleteMany()
    await db.notificationDeliveryControl.update({ where: { id: 1 }, data: { paused: false } })
  })
  function repository(client: PrismaService = db as PrismaService) {
    return new NotificationDeliveryRepository(client, new NotificationShutdownLatch(noopPinoLogger))
  }
  function retention(client: PrismaService = db as PrismaService) {
    return new NotificationRetentionService(client, {} as SingletonCronRunner, noopPinoLogger)
  }
  async function fixture(
    data: Partial<Prisma.NotificationDeliveryUncheckedCreateInput> = {},
    parentId?: string
  ) {
    const parent = await db.notification.create({
      data: {
        ...(parentId ? { id: parentId } : {}),
        recipientUserId: user,
        type: 'account.profile_updated',
        category: 'account',
        schemaVersion: 1,
        payload: { updatedFields: ['name'] },
        occurredAt: old,
        createdAt: old,
        archivedAt: old,
        idempotencyKey: `race:${++sequence}`,
        idempotencyFingerprint: 'fixture',
      },
    })
    const row = await db.notificationDelivery.create({
      data: {
        notificationId: parent.id,
        channel: 'telegram',
        targetKey: '111',
        targetRef: 'shared-target',
        locale: 'en',
        requestContractVersion: 1,
        maxAttempts: 5,
        ...data,
      },
    })
    return { parent, row }
  }
  const failed = {
    status: 'FAILED' as const,
    attemptCount: 5,
    retryableExhaustion: true,
    terminalReasonCode: 'attempts_exhausted',
    terminalAt: old,
    preparedRequest: {},
    preparedRequestHash: 'a'.repeat(64),
    providerScope: 'b'.repeat(64),
  }
  function input(row: NotificationDelivery, operation: WorkCommand['operation']): WorkCommand {
    return {
      contractVersion: 1,
      commandId: uuidv7(),
      workId: 'notification-deliveries',
      operation,
      expectedWorkRevision: 'a'.repeat(64),
      reason: 'Controlled race contract',
      targets: [{ id: row.id, incarnation: row.incarnation, revision: deliveryRevision(row) }],
      parameters:
        operation === 'cleanup'
          ? {
              cutoff: new Date(Date.now() - 30 * 86400000).toISOString(),
              states: ['failed', 'completed'],
            }
          : {},
    }
  }
  async function command(
    row: NotificationDelivery,
    operation: WorkCommand['operation'],
    client: PrismaService = db as PrismaService
  ) {
    const request = input(row, operation)
    return client.$transaction(async (tx) => {
      const ctx = {
        tx,
        now: new Date(),
        commandId: request.commandId,
        dispatchId: uuidv7(),
        dispatchNotAfter: new Date(Date.now() + 60000),
        principal: {
          type: 'jwt' as const,
          sub: user,
          sid: 'race-session',
          systemRole: SystemRole.SuperAdmin,
        },
      }
      const locked = await control.lock(ctx, request)
      return (await control.apply(ctx, locked, request)).get(row.id)!
    })
  }
  async function pause(client: PrismaService = db as PrismaService) {
    const gate = await db.notificationDeliveryControl.findUniqueOrThrow({ where: { id: 1 } })
    const request = {
      ...input({} as NotificationDelivery, 'pause'),
      targets: [],
      expectedWorkRevision: notificationWorkDigest([gate.paused, gate.revision]),
    }
    return client.$transaction(async (tx) => {
      const ctx = {
        tx,
        now: new Date(),
        commandId: request.commandId,
        dispatchId: uuidv7(),
        dispatchNotAfter: new Date(Date.now() + 60000),
        principal: {
          type: 'jwt' as const,
          sub: user,
          sid: 'race-session',
          systemRole: SystemRole.SuperAdmin,
        },
      }
      const locked = await control.lock(ctx, request)
      return control.apply(ctx, locked, request)
    })
  }

  it('claim wins the gate lock; pause waits for its commit and the committed attempt drains', async () => {
    const { row } = await fixture()
    const barrier = transactionBarrier(
      db,
      (sql) => sql.includes('notification_delivery_control') && sql.includes('FOR SHARE')
    )
    const claiming = repository(barrier.facade).claimDueBatch(1)
    await barrier.entered
    const pausing = pause()
    try {
      await waitForBlocked(db)
    } finally {
      barrier.release()
    }
    const claims = await claiming
    if (claims === CUTOFF) throw new Error('cutoff')
    expect(claims).toHaveLength(1)
    await pausing
    await fixture({ targetKey: '222' })
    expect(await repository().claimDueBatch(1)).toEqual([])
    await db.$transaction((tx) => markNotificationTransport(tx, row.id, claims[0]!.leaseToken))
    expect(
      await repository().finalizeDelivered(claims[0]!, 'accepted-after-pause', 0)
    ).toMatchObject({ state: 'delivered' })
    expect(await db.notificationDelivery.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'DELIVERED',
      acceptedSeen: true,
    })
  })

  it('pause wins the gate lock; a waiting claimant observes committed pause and claims nothing', async () => {
    await fixture()
    const barrier = transactionBarrier(
      db,
      (sql) => sql.includes('notification_delivery_control') && sql.includes('FOR UPDATE')
    )
    const pausing = pause(barrier.facade)
    await barrier.entered
    const claiming = repository().claimDueBatch(1)
    try {
      await waitForBlocked(db)
    } finally {
      barrier.release()
    }
    await pausing
    expect(await claiming).toEqual([])
    expect(await db.notificationDeliveryAttempt.count()).toBe(0)
  })

  it('samples due time after the claim gate wait instead of using transaction start time', async () => {
    const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const boundary = new Date(clock!.now.getTime() + 150)
    const { row } = await fixture({ availableAt: boundary })
    const entered = deferred(),
      release = deferred()
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM notifications.notification_delivery_control WHERE id = 1 FOR UPDATE`
      entered.resolve()
      await release.promise
    })
    await entered.promise
    const claiming = repository().claimDueBatch(1)
    try {
      await waitForBlocked(db)
      await waitForDatabaseTime(db, boundary)
    } finally {
      release.resolve()
    }
    await blocker
    const claims = await claiming
    if (claims === CUTOFF) throw new Error('cutoff')
    expect(claims.map((claim) => claim.id)).toEqual([row.id])
    expect(
      (
        await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })
      ).leaseExpiresAt!.getTime()
    ).toBeGreaterThan(boundary.getTime())
  })

  it.each(['retry', 'cleanup', 'parent', 'pruning'] as const)(
    '%s wins first against retry without resurrecting or pruning reserved work',
    async (winner) => {
      const { row, parent } = await fixture(failed)
      if (winner === 'pruning')
        await db.notification.update({
          where: { id: parent.id },
          data: { archivedAt: null, createdAt: new Date() },
        })
      await db.notificationDeliveryAttempt.create({
        data: {
          deliveryId: row.id,
          attemptNumber: 5,
          leaseToken: 'old-attempt',
          startedAt: old,
          finishedAt: winner === 'parent' ? new Date() : old,
          outcome: 'TRANSIENT_FAILURE',
          effectState: 'proven_none',
        },
      })
      const barrier = transactionBarrier(
        db,
        (sql) =>
          sql.includes('notifications.notifications') &&
          sql.includes('FOR ') &&
          (winner !== 'pruning' || sql.includes('notification_delivery_attempts')) &&
          (winner !== 'parent' || sql.includes('n."archivedAt" IS NOT NULL'))
      )
      const first =
        winner === 'retry'
          ? command(row, 'retry', barrier.facade)
          : winner === 'cleanup'
            ? command(row, 'cleanup', barrier.facade)
            : winner === 'parent'
              ? retention(barrier.facade).runRetention()
              : retention(barrier.facade).runRetention(new Date(Date.now() + 50 * 86400000))
      await barrier.entered
      const second = winner === 'retry' ? command(row, 'cleanup') : command(row, 'retry')
      try {
        await waitForBlocked(db)
      } finally {
        barrier.release()
      }
      const results = await Promise.all([first, second])
      const expected = {
        retry: {
          outcome: { state: 'rejected' },
          rows: 1,
          parents: 1,
          attempts: 1,
          grant: 'reserved',
          pruned: 0,
        },
        cleanup: {
          outcome: { state: 'rejected', reason: 'HISTORY_EXPIRED' },
          rows: 0,
          parents: 1,
          attempts: 0,
          grant: null,
          pruned: null,
        },
        parent: {
          outcome: { state: 'rejected', reason: 'HISTORY_EXPIRED' },
          rows: 0,
          parents: 0,
          attempts: 0,
          grant: null,
          pruned: null,
        },
        pruning: {
          outcome: { state: 'applied' },
          rows: 1,
          parents: 1,
          attempts: 0,
          grant: 'reserved',
          pruned: 5,
        },
      }[winner]
      expect(results[1]).toMatchObject(expected.outcome)
      expect(await db.notificationDelivery.count({ where: { id: row.id } })).toBe(expected.rows)
      expect(await db.notification.count({ where: { id: parent.id } })).toBe(expected.parents)
      expect(await db.notificationDeliveryAttempt.count({ where: { deliveryId: row.id } })).toBe(
        expected.attempts
      )
      const retained = await db.notificationDelivery.findUnique({ where: { id: row.id } })
      expect(retained?.manualGrant ?? null).toBe(expected.grant)
      expect(retained?.historyPrunedThrough ?? null).toBe(expected.pruned)
      expect((await retention().runRetention()).finishedAttempts).toBe(0)
    }
  )
  it.each(['parent', 'pruning'] as const)(
    'retry commits before %s retention and protects its evidence',
    async (bucket) => {
      const { parent, row } = await fixture(failed)
      await db.notification.update({
        where: { id: parent.id },
        data: {
          archivedAt: bucket === 'pruning' ? null : old,
          createdAt: bucket === 'pruning' ? new Date() : old,
        },
      })
      await db.notificationDeliveryAttempt.create({
        data: {
          deliveryId: row.id,
          attemptNumber: 5,
          leaseToken: 'old',
          startedAt: old,
          finishedAt: old,
          outcome: 'TRANSIENT_FAILURE',
          effectState: 'proven_none',
        },
      })
      const barrier = transactionBarrier(
        db,
        (sql) => sql.includes('notifications.notifications') && sql.includes('FOR SHARE')
      )
      const granting = command(row, 'retry', barrier.facade)
      await barrier.entered
      try {
        const result = await retention().runRetention(new Date(Date.now() + 50 * 86400000))
        expect(result.failures).toEqual([])
        expect(result.archivedNotifications).toBe(0)
        expect(result.finishedAttempts).toBe(0)
      } finally {
        barrier.release()
      }
      expect(await granting).toMatchObject({ state: 'applied' })
      expect(await db.notificationDeliveryAttempt.count({ where: { deliveryId: row.id } })).toBe(1)
      expect(
        (await retention().runRetention(new Date(Date.now() + 50 * 86400000))).finishedAttempts
      ).toBe(0)
    }
  )

  it('refreshes cleanup eligibility after its real parent lock wait crosses the completion-age boundary', async () => {
    const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const boundary = new Date(clock!.now.getTime() + 180)
    const { parent, row } = await fixture({
      ...failed,
      terminalAt: new Date(boundary.getTime() - 30 * 86400000),
    })
    const held = deferred(),
      release = deferred()
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM notifications.notifications WHERE id = ${parent.id} FOR UPDATE`
      held.resolve()
      await release.promise
    })
    await held.promise
    const request = input(row, 'cleanup')
    request.parameters.cutoff = row.terminalAt!.toISOString()
    const attempt = db.$transaction(async (tx) => {
      const ctx = {
        tx,
        now: clock!.now,
        commandId: request.commandId,
        dispatchId: uuidv7(),
        dispatchNotAfter: new Date(Date.now() + 60000),
        principal: {
          type: 'jwt' as const,
          sub: user,
          sid: 'race',
          systemRole: SystemRole.SuperAdmin,
        },
      }
      const locked = await control.lock(ctx, request)
      expect(ctx.now.getTime()).toBeGreaterThanOrEqual(boundary.getTime())
      expect(control.eligibility(ctx, locked, request)).toBeNull()
      return control.apply(ctx, locked, request)
    })
    try {
      await waitForBlocked(db)
      await waitForDatabaseTime(db, boundary)
    } finally {
      release.resolve()
    }
    await blocker
    expect((await attempt).get(row.id)).toMatchObject({ state: 'applied' })
  })

  it('locks reverse-parent children globally before competing ordered revoke; unknown survives late finalize and retention', async () => {
    const first = await fixture({ id: 'z-active' }, 'parent-a')
    const second = await fixture({ id: 'a-active' }, 'parent-z')
    for (const [entry, id] of [
      [first, 'y-terminal'],
      [second, 'b-terminal'],
    ] as const) {
      const terminal = await db.notificationDelivery.create({
        data: {
          ...failed,
          id,
          notificationId: entry.parent.id,
          channel: 'telegram',
          targetKey: id,
          targetRef: 'shared-target',
          locale: 'en',
          maxAttempts: 5,
        },
      })
      await db.notificationDeliveryAttempt.create({
        data: {
          deliveryId: terminal.id,
          attemptNumber: 5,
          leaseToken: id,
          startedAt: old,
          finishedAt: old,
          outcome: 'TRANSIENT_FAILURE',
          effectState: 'proven_none',
        },
      })
    }
    const claims = await repository().claimDueBatch(2)
    if (claims === CUTOFF) throw new Error('cutoff')
    expect(claims).toHaveLength(2)
    for (const claim of claims)
      await db.$transaction((tx) => markNotificationTransport(tx, claim.id, claim.leaseToken))
    const held = deferred(),
      proceed = deferred()
    const revoking = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM notifications.notification_deliveries WHERE id = 'a-active' FOR UPDATE`
      held.resolve()
      await proceed.promise
      return cancelActiveDeliveries(tx, {
        channel: 'telegram',
        targetRef: 'shared-target',
        reason: 'telegram_connection_unlinked',
      })
    })
    await held.promise
    const pruning = retention().runRetention(new Date(Date.now() + 50 * 86400000))
    try {
      await waitForBlocked(db)
    } finally {
      proceed.resolve()
    }
    expect(await revoking).toBe(2)
    expect((await pruning).failures).toEqual([])
    for (const claim of claims) {
      expect(await repository().finalizeDelivered(claim, 'late-result', 0)).toEqual({
        state: 'lease_lost',
      })
      expect(await db.notificationDelivery.findUnique({ where: { id: claim.id } })).toMatchObject({
        status: 'CANCELLED',
        acceptedSeen: false,
        unresolvedEffectCount: 1,
      })
      const reader = new NotificationWorkReader(
        db as PrismaService,
        { ids: () => ['telegram'] } as never,
        {} as NotificationControlTargets
      )
      const detail = await reader.detail(claim.id)
      expect(detail?.history?.attempts[0]).toMatchObject({
        outcome: 'abandoned',
        reason: 'delivery_cancelled',
        certainty: 'unknown',
      })
    }
    expect(
      (await retention().runRetention(new Date(Date.now() + 200 * 86400000))).failures
    ).toEqual([])
    expect(await db.notification.count()).toBe(2)
    expect(
      await db.notificationDeliveryAttempt.count({
        where: { deliveryId: { in: claims.map((claim) => claim.id) } },
      })
    ).toBe(2)
  })

  it.each(['none', 'accepted'] as const)(
    'keeps an expired possible attempt unknown when a new lease finishes with %s',
    async (certainty) => {
      const { row } = await fixture({ maxAttempts: 2 })
      const first = await repository().claimDueBatch(1)
      if (first === CUTOFF || !first[0]) throw new Error('claim missing')
      await db.$transaction((tx) => markNotificationTransport(tx, row.id, first[0]!.leaseToken))
      await db.notificationDelivery.update({
        where: { id: row.id },
        data: { leaseExpiresAt: new Date(0) },
      })
      expect(await repository().reapExpiredLeases()).toMatchObject({ rescheduled: 1 })
      await db.notificationDelivery.update({
        where: { id: row.id },
        data: { nextAttemptAt: new Date(0) },
      })
      const next = await repository().claimDueBatch(1)
      if (next === CUTOFF || !next[0]) throw new Error('claim missing')
      expect(await repository().finalizeDelivered(first[0]!, 'late-stale', 0)).toEqual({
        state: 'lease_lost',
      })
      await db.$transaction((tx) => markNotificationTransport(tx, row.id, next[0]!.leaseToken))
      if (certainty === 'accepted')
        await repository().finalizeDelivered(next[0]!, 'current-accepted', 0)
      else
        await repository().finalizeTransient(
          next[0]!,
          'telegram_rate_limited',
          0,
          undefined,
          'none'
        )
      expect(await db.notificationDelivery.findUnique({ where: { id: row.id } })).toMatchObject({
        status: certainty === 'accepted' ? 'DELIVERED' : 'FAILED',
        attemptCount: 2,
        acceptedSeen: certainty === 'accepted',
        unresolvedEffectCount: 1,
      })
      const reader = new NotificationWorkReader(
        db as PrismaService,
        { ids: () => ['telegram'] } as never,
        {} as NotificationControlTargets
      )
      const detail = await reader.detail(row.id)
      expect(detail).toMatchObject({
        certainty: certainty === 'accepted' ? 'accepted' : 'unknown',
        projection: { unresolved: true },
      })
      expect(detail?.capabilities.find(({ operation }) => operation === 'retry')).toMatchObject({
        allowed: false,
        reason: 'EFFECT_UNKNOWN',
      })
      expect(detail?.history?.attempts[1]).toMatchObject({
        outcome: 'abandoned',
        reason: 'lease_expired',
        certainty: 'unknown',
      })
      expect(
        (await retention().runRetention(new Date(Date.now() + 200 * 86400000))).failures
      ).toEqual([])
      expect(await db.notificationDeliveryAttempt.count({ where: { deliveryId: row.id } })).toBe(2)
    }
  )
})
