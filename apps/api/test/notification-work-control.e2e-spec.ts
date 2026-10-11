import { jest } from '@jest/globals'
import type { ModuleRef } from '@nestjs/core'
import { PrismaPg } from '@prisma/adapter-pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { v7 as uuidv7 } from 'uuid'

import { SystemRole, type WorkCommand } from '@amcore/shared'

import { canonicalJsonHash } from '../src/common/utils/canonical-json'
import { EmailTargetResolver } from '../src/core/notifications/channels/email-target.resolver'
import { NotificationChannelRegistry } from '../src/core/notifications/channels/notification-channel.registry'
import { NotificationControlTargets } from '../src/core/notifications/channels/notification-control-targets'
import { TelegramBotApiClient } from '../src/core/notifications/channels/telegram/telegram-bot-api.client'
import { TelegramTargetResolver } from '../src/core/notifications/channels/telegram/telegram-target.resolver'
import { deliveryRevision } from '../src/core/notifications/control/notification-control-policy'
import { notificationProviderScope } from '../src/core/notifications/control/notification-provider-scope'
import { NotificationWorkControl } from '../src/core/notifications/control/notification-work-control'
import { NotificationAttemptAdmission } from '../src/core/notifications/dispatch/notification-attempt-admission'
import { NotificationDeliveryRepository } from '../src/core/notifications/dispatch/notification-delivery.repository'
import { markNotificationTransport } from '../src/core/notifications/dispatch/notification-effect-evidence'
import {
  CUTOFF,
  NotificationShutdownLatch,
} from '../src/core/notifications/dispatch/notification-shutdown.latch'
import { NOTIFICATION_CHANNELS } from '../src/core/notifications/notification-composition'
import { NotificationDefinitionRegistry } from '../src/core/notifications/notification-definition.registry'
import type { EnvService } from '../src/env/env.service'
import {
  type NotificationDelivery,
  type Prisma,
  PrismaClient,
} from '../src/generated/prisma/client'
import type { PrismaService } from '../src/prisma'

import { e2eContainerLabels } from './e2e-owned-containers'
import { migrateTestDatabase, noopPinoLogger } from './helpers'

/** Isolated PG proves lifetime-grant serialization and durable effect evidence, without broker I/O. */
describe('Notification delivery control authority', () => {
  let container: StartedPostgreSqlContainer
  let db: PrismaClient
  let repository: NotificationDeliveryRepository
  let control: NotificationWorkControl
  let parent: string
  const targetValidation = jest.fn<NotificationControlTargets['validate']>().mockResolvedValue(null)

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withLabels(e2eContainerLabels())
      .start()
    await migrateTestDatabase(container.getConnectionUri())
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: container.getConnectionUri() }),
    })
    await db.$connect()
    repository = new NotificationDeliveryRepository(
      db as PrismaService,
      new NotificationShutdownLatch(noopPinoLogger)
    )
    control = new NotificationWorkControl({
      validate: targetValidation,
    } as unknown as NotificationControlTargets)
    const user = await db.user.create({
      data: { email: 'control@example.test', emailCanonical: 'control@example.test' },
    })
    parent = (
      await db.notification.create({
        data: {
          recipientUserId: user.id,
          type: 'account.profile_updated',
          schemaVersion: 1,
          category: 'account',
          payload: { updatedFields: ['name'] },
          occurredAt: new Date(),
          idempotencyKey: 'control-fixture',
          idempotencyFingerprint: 'control-fixture',
        },
      })
    ).id
  }, 120000)
  beforeEach(async () => {
    jest.restoreAllMocks()
    targetValidation.mockResolvedValue(null)
    await db.notificationDelivery.deleteMany()
    await db.notificationDeliveryControl.update({ where: { id: 1 }, data: { paused: false } })
  })
  afterAll(async () => {
    await db?.$disconnect()
    await container?.stop()
  }, 60000)

  function delivery(data: Partial<Prisma.NotificationDeliveryUncheckedCreateInput> = {}) {
    return db.notificationDelivery.create({
      data: {
        notificationId: parent,
        channel: 'telegram',
        targetKey: '111',
        targetRef: 'generation-one',
        locale: 'en',
        requestContractVersion: 1,
        maxAttempts: 5,
        ...data,
      },
    })
  }
  async function claim() {
    const rows = await repository.claimDueBatch(1)
    if (rows === CUTOFF || rows.length !== 1) throw new Error('expected one claim')
    return rows[0]!
  }
  async function command(
    row: NotificationDelivery,
    operation: 'retry' | 'cancel' | 'pause' | 'resume',
    actor = 'owner-one'
  ) {
    const commandId = uuidv7()
    const input: WorkCommand = {
      contractVersion: 1,
      commandId,
      workId: 'notification-deliveries',
      operation,
      targets: [{ id: row.id, incarnation: row.incarnation, revision: deliveryRevision(row) }],
      expectedWorkRevision: 'a'.repeat(64),
      reason: 'Review fixture',
      parameters: {},
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
          sub: actor,
          sid: 'fixture-session',
          systemRole: SystemRole.SuperAdmin,
        },
      }
      const locked = await control.lock(ctx, input)
      return (await control.apply(ctx, locked, input)).get(row.id)!
    })
  }
  const failed = {
    status: 'FAILED' as const,
    attemptCount: 5,
    maxAttempts: 5,
    retryableExhaustion: true,
    terminalReasonCode: 'attempts_exhausted',
    preparedRequest: {},
    preparedRequestHash: 'a'.repeat(64),
    providerScope: 'b'.repeat(64),
    terminalAt: new Date(),
  }

  it('commits pause against the same authority as claiming; an earlier claim can finish', async () => {
    await delivery()
    const admitted = await claim()
    await db.notificationDeliveryControl.update({ where: { id: 1 }, data: { paused: true } })
    await delivery({ targetKey: '222' })
    expect(await repository.claimDueBatch(1)).toEqual([])
    await repository.finalizePermanent(admitted, 'fixture_before_io', 0, 'none')
    await db.notificationDeliveryControl.update({ where: { id: 1 }, data: { paused: false } })
    expect((await claim()).targetKey).toBe('222')
  })

  it('serializes two commands into one grant, retains the provider floor and never resets count', async () => {
    const floor = new Date(Date.now() + 3600000)
    const row = await delivery({ ...failed, nextAttemptAt: floor })
    const results = await Promise.all([command(row, 'retry'), command(row, 'retry', 'owner-two')])
    expect(results.map((result) => result.state).sort()).toEqual(['applied', 'rejected'])
    const granted = await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })
    expect(granted).toMatchObject({
      attemptCount: 5,
      maxAttempts: 5,
      manualGrant: 'reserved',
      nextAttemptAt: floor,
    })
    expect(await repository.claimDueBatch(1)).toEqual([])
    await db.notificationDelivery.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(0) },
    })
    const sixth = await claim()
    expect(sixth).toMatchObject({ attemptNumber: 6, maxAttempts: 6 })
    await repository.finalizeTransient(sixth, 'telegram_rate_limited', 0, undefined, 'none')
    const spent = await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })
    expect(await command(spent, 'retry', 'owner-three')).toEqual({
      state: 'rejected',
      reason: 'MANUAL_GRANT_SPENT',
    })
    expect(await repository.claimDueBatch(1)).toEqual([])
  })

  it('burns a reserved grant when a still-pending delivery is cancelled', async () => {
    const row = await delivery(failed)
    expect((await command(row, 'retry')).state).toBe('applied')
    const granted = await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })
    expect((await command(granted, 'cancel')).state).toBe('applied')
    expect(await db.notificationDelivery.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'CANCELLED',
      manualGrant: 'spent',
      attemptCount: 5,
    })
  })

  it('preserves an earlier unknown call through a later independently witnessed HTTP429', async () => {
    const row = await delivery({ maxAttempts: 2 })
    const first = await claim()
    await db.$transaction((tx) => markNotificationTransport(tx, row.id, first.leaseToken))
    await repository.finalizeTransient(first, 'provider_timeout', 0)
    await db.notificationDelivery.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(0) },
    })
    const second = await claim()
    await db.$transaction((tx) => markNotificationTransport(tx, row.id, second.leaseToken))
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 30 } }),
          { status: 429 }
        )
      )
    const client = new TelegramBotApiClient({
      get: (key: string) =>
        key === 'TELEGRAM_BOT_TOKEN' ? '<fake-token>' : 'https://provider.example.test',
    } as EnvService)
    const result = await client.sendMessage({ chatId: '111', text: 'Fixture' })
    if (result.status !== 'transient') throw new Error('expected rate limit')
    await repository.finalizeTransient(
      second,
      result.errorCode,
      0,
      result.retryAfterMs,
      result.effectCertainty
    )
    const current = await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })
    expect(current).toMatchObject({
      status: 'FAILED',
      unresolvedEffectCount: 1,
      retryableExhaustion: true,
    })
    expect(await command(current, 'retry')).toEqual({ state: 'rejected', reason: 'EFFECT_UNKNOWN' })
    expect(
      (
        await db.notificationDeliveryAttempt.findMany({
          where: { deliveryId: row.id },
          orderBy: { attemptNumber: 'asc' },
        })
      ).map((attempt) => attempt.effectState)
    ).toEqual(['unknown', 'proven_none'])
  })
  it('checks retained version, exact request, provider and original target again before actual send', async () => {
    const notification = await db.notification.update({
      where: { id: parent },
      data: {
        type: 'account.password_changed',
        category: 'security',
        schemaVersion: 1,
        payload: { changedAt: new Date().toISOString() },
      },
    })
    const connection = await db.telegramConnection.create({
      data: {
        userId: notification.recipientUserId,
        chatId: '111',
        telegramUserId: '111',
      },
    })
    const env = {
      get: (key: string) =>
        key === 'TELEGRAM_BOT_TOKEN' ? '<fake-token>' : 'https://provider.example.test',
    } as EnvService
    const registry = new NotificationChannelRegistry(NOTIFICATION_CHANNELS, env)
    const descriptor = registry.get('telegram')
    const targets = new NotificationControlTargets(
      registry,
      { get: () => new TelegramTargetResolver() } as unknown as ModuleRef,
      new NotificationDefinitionRegistry(),
      env
    )
    const row = await delivery({ ...failed, targetRef: connection.id })
    const identity = descriptor.manualRetry!.requestIdentity(env, row.id)
    const preparedRequest = {
      formatVersion: 1,
      wireVersion: 1,
      deliveryId: row.id,
      channel: row.channel,
      type: notification.type,
      schemaVersion: 1,
      targetKey: row.targetKey,
      targetRef: row.targetRef,
      ...identity,
      method: 'POST',
      body: JSON.stringify({ chat_id: row.targetKey, text: 'Fixture' }),
    }
    const current = await db.notificationDelivery.update({
      where: { id: row.id },
      data: {
        preparedRequest,
        preparedRequestHash: canonicalJsonHash(preparedRequest),
        providerScope: notificationProviderScope(env, 'telegram', descriptor),
      },
    })
    const variants = [
      [current, notification],
      [{ ...current, providerScope: 'f'.repeat(64) }, notification],
      [current, { ...notification, schemaVersion: 999 }],
      [{ ...current, preparedRequestHash: 'e'.repeat(64) }, notification],
      [{ ...current, preparedRequest: { ...preparedRequest, path: 'other' } }, notification],
      [{ ...current, targetRef: 'old-generation' }, notification],
    ] as const
    const results = []
    for (const [delivery, event] of variants)
      results.push(await db.$transaction((tx) => targets.validate(tx, delivery, event)))
    expect(results).toEqual([
      null,
      'PROVIDER_CHANGED',
      'CONTENT_UNSUPPORTED',
      'CONTENT_UNSUPPORTED',
      'CONTENT_UNSUPPORTED',
      'CONTENT_UNSUPPORTED',
    ])
    targetValidation.mockImplementation((tx, delivery, event) =>
      targets.validate(tx, delivery, event)
    )
    expect((await command(current, 'retry')).state).toBe('applied')
    const sixth = await claim()
    await db.telegramConnection.update({
      where: { id: connection.id },
      data: { status: 'BLOCKED' },
    })
    const transport = jest.fn<() => Promise<string>>().mockResolvedValue('sent')
    const admission = new NotificationAttemptAdmission(
      db as PrismaService,
      new NotificationShutdownLatch(noopPinoLogger),
      targets
    )
    const result = await admission
      .create({ delivery: sixth, notification }, { channel: 'telegram' } as never, {
        signal: new AbortController().signal,
        onTransportStarted: () => undefined,
      })
      .send(transport)
    expect(result).toEqual({ status: 'not_started', reason: 'target_revoked' })
    expect(transport).not.toHaveBeenCalled()
    expect(await db.notificationDelivery.findUnique({ where: { id: row.id } })).toMatchObject({
      manualGrant: 'spent',
      status: 'CANCELLED',
      unresolvedEffectCount: 0,
    })
  })
  it('rejects a changed email at reservation and again at actual-start without sending to a replacement', async () => {
    const notification = await db.notification.update({
      where: { id: parent },
      data: {
        type: 'account.password_changed',
        category: 'security',
        schemaVersion: 1,
        payload: { changedAt: new Date().toISOString() },
      },
    })
    await db.user.update({
      where: { id: notification.recipientUserId },
      data: {
        email: 'original@example.test',
        emailCanonical: 'original@example.test',
        emailVerified: true,
      },
    })
    const env = { get: () => '<fake-provider-setting>' } as unknown as EnvService
    const registry = new NotificationChannelRegistry(NOTIFICATION_CHANNELS, env)
    const descriptor = registry.get('email')
    const targets = new NotificationControlTargets(
      registry,
      { get: () => new EmailTargetResolver() } as unknown as ModuleRef,
      new NotificationDefinitionRegistry(),
      env
    )
    const row = await delivery({
      ...failed,
      channel: 'email',
      targetKey: 'original@example.test',
      targetRef: null,
    })
    const identity = descriptor.manualRetry!.requestIdentity(env, row.id)
    const preparedRequest = {
      formatVersion: 1,
      wireVersion: 1,
      deliveryId: row.id,
      channel: 'email',
      type: notification.type,
      schemaVersion: 1,
      targetKey: row.targetKey,
      targetRef: null,
      ...identity,
      method: 'POST',
      body: JSON.stringify({
        from: 'fixture@example.test',
        to: [row.targetKey],
        subject: 'Fixture',
        html: 'Fixture',
        text: 'Fixture',
      }),
    }
    const current = await db.notificationDelivery.update({
      where: { id: row.id },
      data: {
        preparedRequest,
        preparedRequestHash: canonicalJsonHash(preparedRequest),
        providerScope: notificationProviderScope(env, 'email', descriptor),
      },
    })
    targetValidation.mockImplementation((tx, item, event) => targets.validate(tx, item, event))
    await db.user.update({
      where: { id: notification.recipientUserId },
      data: { email: 'replacement@example.test', emailCanonical: 'replacement@example.test' },
    })
    expect(await command(current, 'retry')).toEqual({ state: 'rejected', reason: 'STATE_CHANGED' })
    expect(
      (await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).manualGrant
    ).toBe('none')
    await db.user.update({
      where: { id: notification.recipientUserId },
      data: { email: row.targetKey, emailCanonical: row.targetKey },
    })
    expect((await command(current, 'retry')).state).toBe('applied')
    const sixth = await claim()
    await db.user.update({
      where: { id: notification.recipientUserId },
      data: { email: 'replacement@example.test', emailCanonical: 'replacement@example.test' },
    })
    const transport = jest.fn<() => Promise<string>>().mockResolvedValue('sent')
    const admission = new NotificationAttemptAdmission(
      db as PrismaService,
      new NotificationShutdownLatch(noopPinoLogger),
      targets
    )
    expect(
      await admission
        .create({ delivery: sixth, notification }, { channel: 'email' } as never, {
          signal: new AbortController().signal,
          onTransportStarted: () => undefined,
        })
        .send(transport)
    ).toEqual({ status: 'not_started', reason: 'target_revoked' })
    expect(transport).not.toHaveBeenCalled()
    expect(await db.notificationDelivery.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'CANCELLED',
      manualGrant: 'spent',
      targetKey: 'original@example.test',
      attemptCount: 6,
      unresolvedEffectCount: 0,
    })
  })
  it('fails closed only for claims and pause/resume when the singleton is missing', async () => {
    const row = await delivery()
    await db.notificationDeliveryControl.delete({ where: { id: 1 } })
    try {
      await expect(repository.claimDueBatch(1)).rejects.toThrow(
        'notification_claim_authority_missing'
      )
      await expect(command(row, 'pause')).rejects.toThrow('notification_claim_authority_missing')
      await expect(command(row, 'resume')).rejects.toThrow('notification_claim_authority_missing')
      expect((await command(row, 'cancel')).state).toBe('applied')
      expect(await db.notificationDelivery.findUnique({ where: { id: row.id } })).toMatchObject({
        status: 'CANCELLED',
        attemptCount: 0,
      })
    } finally {
      await db.notificationDeliveryControl.create({ data: { id: 1 } })
    }
  })
})
