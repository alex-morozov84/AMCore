import { jest } from '@jest/globals'
import request from 'supertest'
import { v7 as uuidv7 } from 'uuid'

import { type WorkCommand, workReceiptSchema } from '@amcore/shared'

import { AuditLogService } from '../src/core/audit/audit-log.service'
import { EmailTargetResolver } from '../src/core/notifications/channels/email-target.resolver'
import { TelegramLinkService } from '../src/core/notifications/channels/telegram/telegram-link.service'
import { deliveryRevision } from '../src/core/notifications/control/notification-control-policy'
import { NotificationWorkControl } from '../src/core/notifications/control/notification-work-control'
import { NotificationWorkReader } from '../src/core/notifications/control/notification-work-reader'

import {
  deferred,
  waitForBlocked,
  waitForDatabaseTime,
} from './fixtures/notification-work/barriers'
import { signAccessToken } from './helpers'
import {
  createTgUser,
  issueTokenRow,
  postUpdate,
  resetTelegramE2E,
  setupTelegramE2E,
  startUpdate,
  teardownTelegramE2E,
  type TelegramE2E,
} from './telegram-e2e.helpers'

const base = '/admin/background-work'

describe('Notification adapter through the common HTTP authority', () => {
  let tg: TelegramE2E
  let token: string
  let user: string
  beforeAll(async () => {
    tg = await setupTelegramE2E()
  }, 120000)
  afterAll(async () => {
    await teardownTelegramE2E(tg)
  }, 120000)
  beforeEach(async () => {
    jest.restoreAllMocks()
    await resetTelegramE2E(tg)
    await tg.prisma.notificationDeliveryControl.update({
      where: { id: 1 },
      data: { paused: false },
    })
    user = await createTgUser(tg.prisma)
    await tg.prisma.user.update({ where: { id: user }, data: { systemRole: 'SUPER_ADMIN' } })
    const session = await tg.prisma.session.create({
      data: {
        userId: user,
        familyId: uuidv7(),
        refreshToken: uuidv7(),
        lastAuthAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      },
    })
    token = signAccessToken(tg.app, { sub: user, sid: session.id, systemRole: 'SUPER_ADMIN' })
    await tg.prisma.telegramConnection.create({
      data: { userId: user, chatId: '111', telegramUserId: '111' },
    })
  })

  async function produce(key = uuidv7()) {
    const input = {
      recipientUserId: user,
      type: 'account.password_changed',
      payload: { changedAt: '2026-10-11T00:00:00.000Z' },
      idempotencyKey: `account.password_changed:${key}`,
    }
    const result = await tg.notifications.notify(input)
    const row = await tg.prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: result.notificationId, channel: 'telegram' },
    })
    return { input, row }
  }
  async function capture(
    operation: WorkCommand['operation'],
    row?: Awaited<ReturnType<typeof produce>>['row']
  ) {
    const response = await request(tg.app.getHttpServer())
      .get(`${base}/works`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    const work = response.body.find(
      (entry: { id: string }) => entry.id === 'notification-deliveries'
    )
    return {
      contractVersion: 1,
      commandId: uuidv7(),
      workId: work.id,
      operation,
      expectedWorkRevision: work.revision,
      reason: 'Notification control contract',
      targets: row
        ? [{ id: row.id, incarnation: row.incarnation, revision: deliveryRevision(row) }]
        : [],
      parameters: {},
    } as WorkCommand
  }
  async function post(command: WorkCommand, status = 200) {
    return request(tg.app.getHttpServer())
      .post(`${base}/commands`)
      .set('Authorization', `Bearer ${token}`)
      .send(command)
      .expect(status)
  }
  async function exhausted() {
    const { row } = await produce()
    tg.fake.setSendResponse(429, { ok: false, error_code: 429, parameters: { retry_after: 1 } })
    for (let number = 1; number <= 5; number++) {
      await tg.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: { nextAttemptAt: new Date(0) },
      })
      await tg.dispatch.runDispatchCycle()
      const current = await tg.prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: row.id },
      })
      expect(current.attemptCount).toBe(number)
      expect(current.unresolvedEffectCount).toBe(0)
      expect(tg.fake.sendCalls).toHaveLength(number)
    }
    return tg.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })
  }

  it('records five full Telegram HTTP429 attempts and permits exactly one sixth via HTTP, replay and audit', async () => {
    const row = await exhausted()
    expect(row).toMatchObject({ status: 'FAILED', retryableExhaustion: true, acceptedSeen: false })
    const command = await capture('retry', row)
    const first = workReceiptSchema.parse((await post(command)).body)
    expect(first.state).toBe('applied')
    const granted = await tg.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: row.id },
    })
    expect(granted).toMatchObject({
      manualGrant: 'reserved',
      attemptCount: 5,
      maxAttempts: 5,
      grantActorId: user,
      grantCommandId: command.commandId,
    })
    expect(granted.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(row.nextAttemptAt!.getTime())
    expect(workReceiptSchema.parse((await post(command)).body).targets).toEqual(first.targets)
    expect(
      await tg.prisma.auditLog.count({
        where: {
          action: 'background_work.command_intent',
          targetId: 'notification-deliveries',
        },
      })
    ).toBe(1)
    tg.fake.setSendResponse(200, { ok: true, result: { message_id: 6 } })
    await tg.prisma.notificationDelivery.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(0) },
    })
    await tg.dispatch.runDispatchCycle()
    await tg.dispatch.runDispatchCycle()
    expect(tg.fake.sendCalls).toHaveLength(6)
    const spent = await tg.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })
    expect(spent).toMatchObject({
      status: 'DELIVERED',
      attemptCount: 6,
      maxAttempts: 5,
      manualGrant: 'spent',
      grantAttemptNumber: 6,
      acceptedSeen: true,
      unresolvedEffectCount: 0,
    })
    const history = await tg.prisma.notificationDeliveryAttempt.findMany({
      where: { deliveryId: row.id },
      orderBy: { attemptNumber: 'asc' },
    })
    expect(history.map((attempt) => attempt.effectState)).toEqual([
      ...Array(5).fill('proven_none'),
      'accepted',
    ])
    expect(history[5]).toMatchObject({ grantActorId: user, grantCommandId: command.commandId })
    expect(workReceiptSchema.parse((await post(await capture('retry', spent))).body).state).toBe(
      'rejected'
    )
    expect(tg.fake.sendCalls).toHaveLength(6)
  })

  it('rolls back notification mutation and dispatch receipt when strict outcome audit fails', async () => {
    const { row } = await produce()
    const command = await capture('cancel', row)
    const audit = tg.app.get(AuditLogService, { strict: false })
    const record = audit.record.bind(audit)
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (...args) => {
      if (
        args[0].action === 'background_work.command_outcome' &&
        args[0].metadata?.outcome === 'applied'
      )
        throw new Error('test audit rollback')
      return record(...args)
    })
    await post(command, 500)
    spy.mockRestore()
    expect(
      await tg.prisma.notificationDelivery.findUnique({ where: { id: row.id } })
    ).toMatchObject({ status: 'PENDING', controlRevision: row.controlRevision })
    expect(
      await tg.prisma.backgroundCommandTarget.findFirst({ where: { commandId: command.commandId } })
    ).toMatchObject({ state: 'prepared', dispatchId: null })
    expect(workReceiptSchema.parse((await post(command)).body).state).toBe('requested')
    expect(
      (await tg.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).status
    ).toBe('PENDING')
  })

  it('refuses a same-chat relink generation and preserves existing-occurrence replay after cleanup', async () => {
    const row = await exhausted()
    await tg.app.get(TelegramLinkService, { strict: false }).unlink(user)
    const raw = await issueTokenRow(tg.prisma, user)
    await postUpdate(tg.app, startUpdate(9901, 111, raw)).expect(200)
    const replacement = await tg.prisma.telegramConnection.findUniqueOrThrow({
      where: { userId: user },
    })
    expect(replacement.chatId).toBe(row.targetKey)
    expect(replacement.id).not.toBe(row.targetRef)
    const detail = await tg.app.get(NotificationWorkReader).detail(row.id)
    expect(detail?.capabilities.find((item) => item.operation === 'retry')).toMatchObject({
      allowed: false,
      reason: 'STATE_CHANGED',
    })
    expect(workReceiptSchema.parse((await post(await capture('retry', row))).body).state).toBe(
      'rejected'
    )
    const produced = await produce('replay-after-cleanup')
    expect(
      workReceiptSchema.parse((await post(await capture('cancel', produced.row))).body).state
    ).toBe('applied')
    const terminal = await tg.prisma.notificationDelivery.update({
      where: { id: produced.row.id },
      data: { terminalAt: new Date(Date.now() - 31 * 86400000) },
    })
    const cleanup = await capture('cleanup', terminal)
    cleanup.parameters = { cutoff: terminal.terminalAt!.toISOString(), states: ['completed'] }
    expect(workReceiptSchema.parse((await post(cleanup)).body).state).toBe('applied')
    expect((await tg.notifications.notify(produced.input)).notificationId).toBe(
      produced.row.notificationId
    )
    expect(await tg.prisma.notificationDelivery.count({ where: { id: produced.row.id } })).toBe(0)
  })

  it('refuses changed or unverified original email without resolving a replacement', async () => {
    const resolver = new EmailTargetResolver()
    const original = (await tg.prisma.user.findUniqueOrThrow({ where: { id: user } }))
      .emailCanonical
    expect(
      await tg.prisma.$transaction((tx) =>
        resolver.validateDelivery(tx, { targetKey: original }, user)
      )
    ).toBeNull()
    await tg.prisma.user.update({
      where: { id: user },
      data: { email: 'changed@example.test', emailCanonical: 'changed@example.test' },
    })
    expect(
      await tg.prisma.$transaction((tx) =>
        resolver.validateDelivery(tx, { targetKey: original }, user)
      )
    ).toBe('STATE_CHANGED')
    await tg.prisma.user.update({ where: { id: user }, data: { emailVerified: false } })
    expect(
      await tg.prisma.$transaction((tx) =>
        resolver.validateDelivery(tx, { targetKey: 'changed@example.test' }, user)
      )
    ).toBe('STATE_CHANGED')
    expect(tg.fake.sendCalls).toHaveLength(0)
  })
  it('lets a held real transport drain after HTTP pause while refusing new claims', async () => {
    const first = await produce()
    const held = tg.fake.holdNextSend()
    const draining = tg.dispatch.drainDueBatches()
    await held.started
    try {
      expect(workReceiptSchema.parse((await post(await capture('pause'))).body).state).toBe(
        'applied'
      )
      const second = await produce()
      await tg.dispatch.drainDueBatches()
      expect(
        await tg.prisma.notificationDelivery.findUnique({ where: { id: second.row.id } })
      ).toMatchObject({ status: 'PENDING', attemptCount: 0 })
      expect(tg.fake.sendCalls).toHaveLength(1)
    } finally {
      held.release()
      await draining
    }
    expect(
      await tg.prisma.notificationDelivery.findUnique({ where: { id: first.row.id } })
    ).toMatchObject({
      status: 'DELIVERED',
      attemptCount: 1,
      acceptedSeen: true,
      unresolvedEffectCount: 0,
    })
    expect(
      await tg.prisma.notificationDeliveryControl.findUnique({ where: { id: 1 } })
    ).toMatchObject({ paused: true })
  })

  it('common dispatcher resamples time after the adapter lock crosses cleanup age', async () => {
    const produced = await produce()
    const [clock] = await tg.prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const boundary = new Date(clock!.now.getTime() + 1500)
    const row = await tg.prisma.notificationDelivery.update({
      where: { id: produced.row.id },
      data: {
        status: 'FAILED',
        terminalAt: new Date(boundary.getTime() - 30 * 86400000),
      },
    })
    const command = await capture('cleanup', row)
    command.parameters = { cutoff: row.terminalAt!.toISOString(), states: ['failed'] }
    const held = deferred(),
      release = deferred()
    const blocker = tg.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(424242)::text`
      held.resolve()
      await release.promise
    })
    await Promise.race([
      held.promise,
      blocker.then(() => {
        throw new Error('Lock holder ended before admission')
      }),
    ])
    const adapter = tg.app.get(NotificationWorkControl, { strict: false })
    const lock = adapter.lock.bind(adapter)
    let calls = 0
    let adapterSample: Date | undefined
    const spy = jest.spyOn(adapter, 'lock').mockImplementation(async (ctx, input) => {
      const state = await lock(ctx, input)
      if (++calls === 2) {
        adapterSample = ctx.now
        await ctx.tx
          .$queryRaw`SELECT set_config('lock_timeout', '2000ms', true), set_config('statement_timeout', '2000ms', true)`
        await ctx.tx.$queryRaw`SELECT pg_advisory_xact_lock(424242)::text`
      }
      return state
    })
    const applying = post(command)
    // Supertest starts on await/then; hold the executing request while observing PG locks.
    const execution = applying.then((response) => response)
    try {
      await waitForBlocked(tg.prisma)
      await waitForDatabaseTime(tg.prisma, boundary)
    } finally {
      release.resolve()
    }
    await blocker
    expect(workReceiptSchema.parse((await execution).body).state).toBe('applied')
    expect(adapterSample?.getTime() ?? Infinity).toBeLessThan(boundary.getTime())
    spy.mockRestore()
    expect(await tg.prisma.notificationDelivery.count({ where: { id: row.id } })).toBe(0)
  })
})
