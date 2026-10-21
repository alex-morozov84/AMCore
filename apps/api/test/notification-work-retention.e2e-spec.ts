import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { v7 as uuidv7 } from 'uuid'

import { SystemRole, type WorkCommand } from '@amcore/shared'

import type { NotificationChannelRegistry } from '../src/core/notifications/channels/notification-channel.registry'
import type { NotificationControlTargets } from '../src/core/notifications/channels/notification-control-targets'
import { deliveryRevision } from '../src/core/notifications/control/notification-control-policy'
import { NotificationWorkControl } from '../src/core/notifications/control/notification-work-control'
import { NotificationWorkReader } from '../src/core/notifications/control/notification-work-reader'
import { NotificationRetentionService } from '../src/core/notifications/notification-retention.service'
import {
  type NotificationDelivery,
  type Prisma,
  PrismaClient,
} from '../src/generated/prisma/client'
import type { ScheduledJobExecutor } from '../src/infrastructure/schedule/scheduled-job.executor'
import type { PrismaService } from '../src/prisma'

import { e2eContainerLabels } from './e2e-owned-containers'
import { migrateTestDatabase, noopPinoLogger } from './helpers'

const old = new Date(Date.now() - 45 * 86400000)

describe('Notification retention and safe history', () => {
  let container: StartedPostgreSqlContainer
  let db: PrismaClient
  let retention: NotificationRetentionService
  let control: NotificationWorkControl
  let reader: NotificationWorkReader
  let recipient: string
  let sequence = 0

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    await migrateTestDatabase(container.getConnectionUri())
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: container.getConnectionUri() }),
    })
    await db.$connect()
    recipient = (
      await db.user.create({
        data: { email: 'retention@example.test', emailCanonical: 'retention@example.test' },
      })
    ).id
    retention = new NotificationRetentionService(
      db as PrismaService,
      {} as ScheduledJobExecutor,
      noopPinoLogger
    )
    control = new NotificationWorkControl({
      validate: async () => null,
    } as unknown as NotificationControlTargets)
    reader = new NotificationWorkReader(
      db as PrismaService,
      { ids: () => ['in_app', 'telegram', 'email'] } as NotificationChannelRegistry,
      { validate: async () => null } as unknown as NotificationControlTargets
    )
  }, 120000)
  beforeEach(async () => {
    await db.notification.deleteMany()
  })
  afterAll(async () => {
    await db?.$disconnect()
    await container?.stop()
  }, 60000)

  async function fixture(
    data: Partial<Prisma.NotificationDeliveryUncheckedCreateInput> = {},
    archived = false
  ) {
    const parent = await db.notification.create({
      data: {
        recipientUserId: recipient,
        type: 'account.profile_updated',
        schemaVersion: 1,
        category: 'account',
        payload: { updatedFields: ['name'] },
        occurredAt: old,
        createdAt: old,
        ...(archived ? { archivedAt: old } : {}),
        idempotencyKey: `retention:${++sequence}`,
        idempotencyFingerprint: 'fixture',
      },
    })
    const row = await db.notificationDelivery.create({
      data: {
        notificationId: parent.id,
        channel: 'telegram',
        targetKey: '111',
        locale: 'en',
        maxAttempts: 5,
        status: 'FAILED',
        terminalAt: old,
        createdAt: old,
        attemptCount: 5,
        ...data,
      },
    })
    return { parent, row }
  }
  async function cleanup(row: NotificationDelivery, cutoff = new Date(Date.now() - 30 * 86400000)) {
    const commandId = uuidv7()
    const command: WorkCommand = {
      contractVersion: 1,
      commandId,
      workId: 'notification-deliveries',
      operation: 'cleanup',
      targets: [{ id: row.id, incarnation: row.incarnation, revision: deliveryRevision(row) }],
      expectedWorkRevision: 'a'.repeat(64),
      reason: 'Review cleanup fixture',
      parameters: { cutoff: cutoff.toISOString(), states: ['failed', 'completed'] },
    }
    return db.$transaction(async (tx) => {
      const ctx = {
        tx,
        now: new Date(),
        commandId,
        dispatchId: uuidv7(),
        dispatchNotAfter: new Date(Date.now() + 60000),
        principal: {
          type: 'jwt' as const,
          sub: recipient,
          sid: 'fixture',
          systemRole: SystemRole.SuperAdmin,
        },
      }
      const locked = await control.lock(ctx, command)
      return (await control.apply(ctx, locked, command)).get(row.id)!
    })
  }

  it('uses completion age and keeps parent, in-app and siblings during operator cleanup', async () => {
    const { parent, row } = await fixture()
    const inApp = await db.notificationDelivery.create({
      data: {
        notificationId: parent.id,
        channel: 'in_app',
        targetKey: recipient,
        locale: 'en',
        maxAttempts: 1,
        status: 'DELIVERED',
        terminalAt: old,
      },
    })
    const sibling = await db.notificationDelivery.create({
      data: {
        notificationId: parent.id,
        channel: 'email',
        targetKey: 'masked@example.test',
        locale: 'en',
        maxAttempts: 5,
      },
    })
    expect((await cleanup(row)).state).toBe('applied')
    expect(await db.notification.count({ where: { id: parent.id } })).toBe(1)
    expect(
      (await db.notificationDelivery.findMany({ where: { notificationId: parent.id } }))
        .map((item) => item.id)
        .sort()
    ).toEqual([inApp.id, sibling.id].sort())
    const recent = await fixture({ terminalAt: new Date() })
    expect(await cleanup(recent.row)).toMatchObject({ state: 'rejected', reason: 'COOLDOWN' })
  })

  it.each([
    { unresolvedEffectCount: 1 },
    { legacyUnverified: true },
    { manualGrant: 'reserved' },
    { status: 'PROCESSING' as const },
  ])('protects parent and old attempts from nightly retention (%j)', async (metadata) => {
    const { parent, row } = await fixture(metadata, true)
    await db.notificationDeliveryAttempt.create({
      data: {
        deliveryId: row.id,
        attemptNumber: 1,
        leaseToken: 'old-fixture',
        startedAt: old,
        finishedAt: old,
        outcome: 'ABANDONED',
        effectState: 'unknown',
      },
    })
    expect((await retention.runRetention()).failures).toEqual([])
    expect(await db.notification.count({ where: { id: parent.id } })).toBe(1)
    expect(await db.notificationDeliveryAttempt.count({ where: { deliveryId: row.id } })).toBe(1)
    const expectedReason =
      metadata.unresolvedEffectCount || metadata.legacyUnverified
        ? 'EFFECT_UNKNOWN'
        : metadata.manualGrant === 'reserved'
          ? 'RELATED_JOB'
          : 'ACTIVE_JOB'
    expect(await cleanup(row)).toMatchObject({ state: 'rejected', reason: expectedReason })
  })

  it('prunes resolved old attempts while preserving compact certainty and the grant-linked attempt', async () => {
    const { row } = await fixture({
      status: 'DELIVERED',
      acceptedSeen: true,
      manualGrant: 'spent',
      grantAttemptNumber: 6,
      grantActorId: recipient,
      grantCommandId: uuidv7(),
      attemptCount: 6,
    })
    await db.notificationDeliveryAttempt.createMany({
      data: [5, 6].map((number) => ({
        deliveryId: row.id,
        attemptNumber: number,
        leaseToken: `old-${number}`,
        startedAt: old,
        finishedAt: old,
        outcome: 'DELIVERED',
        effectState: 'accepted',
        ...(number === 6
          ? { grantActorId: row.grantActorId, grantCommandId: row.grantCommandId }
          : {}),
      })),
    })
    expect((await retention.runRetention()).finishedAttempts).toBe(1)
    const current = await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })
    expect(current).toMatchObject({
      acceptedSeen: true,
      unresolvedEffectCount: 0,
      manualGrant: 'spent',
      historyPrunedThrough: 5,
      grantActorId: recipient,
      grantCommandId: row.grantCommandId,
    })
    const detail = await reader.detail(row.id)
    expect(detail?.history).toMatchObject({
      historyExpired: true,
      historyTruncated: false,
      oldestRetainedNumber: 6,
    })
    expect(detail?.history?.attempts).toHaveLength(1)
  })

  it('returns an empty valid page for prioritized deliveries without constructing empty SQL', async () => {
    await fixture()
    const page = await reader.list({ state: 'prioritized', page: 1, limit: 25 })
    expect(page.rows).toEqual([])
    expect(page.windowTruncated).toBe(false)
    expect(page.sampledAt).toBeDefined()
  })

  it('searches literal IDs before pagination within the selected status', async () => {
    const { row } = await fixture()
    await fixture()
    const page = await reader.list({
      state: 'failed',
      page: 1,
      limit: 1,
      search: row.id.toUpperCase(),
    })
    expect(page.rows.map((item) => item.identity.id)).toEqual([row.id])
    const differentState = await reader.list({
      state: 'waiting',
      page: 1,
      limit: 25,
      search: row.id,
    })
    expect(differentState.rows).toEqual([])
    const literal = await reader.list({ state: 'failed', page: 1, limit: 25, search: '%' })
    expect(literal.rows).toEqual([])
  })

  it('preserves the independent 513-row witness when search or pagination returns nothing', async () => {
    const { parent } = await fixture()
    await db.notificationDelivery.deleteMany()
    await db.notificationDelivery.createMany({
      data: Array.from({ length: 513 }, (_, index) => ({
        id: `bounded-${String(index).padStart(4, '0')}`,
        notificationId: parent.id,
        channel: 'telegram',
        targetKey: String(index),
        locale: 'en',
        maxAttempts: 5,
        status: 'FAILED',
        createdAt: old,
        terminalAt: old,
      })),
    })
    for (const query of [
      { state: 'failed' as const, page: 1, limit: 25, search: 'absent' },
      { state: 'failed' as const, page: 2, limit: 25, search: 'bounded-0512' },
      { state: 'failed' as const, page: 12, limit: 50 },
      { state: 'failed' as const, page: 512, limit: 50 },
    ]) {
      expect(await reader.list(query)).toMatchObject({ rows: [], windowTruncated: true })
    }
    const last = await reader.list({ state: 'failed', page: 11, limit: 50 })
    expect(last.rows).toHaveLength(12)
    expect(last.windowTruncated).toBe(true)
    await db.notificationDelivery.delete({ where: { id: 'bounded-0000' } })
    expect(
      await reader.list({ state: 'failed', page: 1, limit: 25, search: 'absent' })
    ).toMatchObject({ rows: [], windowTruncated: false })
    expect(await reader.list({ state: 'failed', page: 512, limit: 50 })).toMatchObject({
      rows: [],
      windowTruncated: false,
    })
  })

  it('keeps history detail-only and returns the latest16 attempts with an explicit truncation witness', async () => {
    const { row } = await fixture({ attemptCount: 18 })
    await db.notificationDeliveryAttempt.createMany({
      data: Array.from({ length: 18 }, (_, index) => ({
        deliveryId: row.id,
        attemptNumber: index + 1,
        leaseToken: `history-${index}`,
        outcome: 'TRANSIENT_FAILURE',
        errorCode: index === 17 ? 'raw_provider_text_do_not_expose' : 'telegram_rate_limited',
        effectState: 'proven_none',
      })),
    })
    const detail = await reader.detail(row.id)
    expect(detail?.history?.attempts.map((attempt) => attempt.number)).toEqual(
      Array.from({ length: 16 }, (_, index) => 18 - index)
    )
    expect(detail?.history).toMatchObject({
      historyTruncated: true,
      historyExpired: false,
      oldestRetainedNumber: 1,
    })
    expect(detail?.history?.attempts[0]).not.toHaveProperty('reason')
    const list = await reader.list({ state: 'failed', page: 1, limit: 25 })
    expect(list.rows).toHaveLength(1)
    expect(list.rows[0]).not.toHaveProperty('history')
    expect(JSON.stringify(list)).not.toContain('raw_provider_text')
  })
})
