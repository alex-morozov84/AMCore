import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import {
  AuthErrorCode,
  type RequestPrincipal,
  SupportMailErrorCode,
  supportMailReceiptSchema,
} from '@amcore/shared'

import { SupportMailService } from '../src/core/admin/support-mail/support-mail.service'
import { SupportMailDispatch } from '../src/core/admin/support-mail/support-mail-dispatch.service'
import { AuditLogService } from '../src/core/audit/audit-log.service'
import { EnvService } from '../src/env/env.service'
import { EmailService } from '../src/infrastructure/email/email.service'
import type { EmailProvider, SendEmailParams } from '../src/infrastructure/email/email.types'
import { CleanupService } from '../src/infrastructure/schedule/cleanup.service'
import type { PrismaService } from '../src/prisma'

import { waitForEmailCondition } from './email-secrets.helpers'
import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  setupE2ETest,
  signAccessToken,
  teardownE2ETest,
} from './helpers'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('Console support mail: real admission, token/audit commits and receipt locks', () => {
  let context: E2ETestContext
  let app: INestApplication
  let prisma: PrismaService
  let service: SupportMailService
  let dispatch: SupportMailDispatch
  let actor: RequestPrincipal
  let bearer: string
  let targetId: string
  let providerSend: ReturnType<typeof jest.fn<EmailProvider['send']>>
  let provider: EmailProvider
  let captured: SendEmailParams[] = []
  const route = () => `/admin/users/${targetId}/support-mail`

  beforeAll(async () => {
    providerSend = jest.fn(async (params: SendEmailParams) => {
      params.beforeTransport?.()
      captured.push(params)
      return { id: 'mock-fixture-ack', success: true }
    })
    provider = {
      supportsDirectSecretFence: true,
      send: providerSend,
      sendPrepared: async () => ({ id: 'mock-prepared', success: true }),
    }
    context = await setupE2ETest((builder) =>
      builder.overrideProvider('EmailProvider').useValue(provider)
    )
    app = context.app
    prisma = context.prisma
    service = app.get(SupportMailService)
    dispatch = app.get(SupportMailDispatch)
  }, 120000)
  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    jest.restoreAllMocks()
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    captured = []
    providerSend.mockClear()
    const operator = await prisma.user.create({
      data: {
        email: 'operator@e2e.amcore.test',
        emailCanonical: 'operator@e2e.amcore.test',
        systemRole: 'SUPER_ADMIN',
        passwordHash: 'fixture-hash',
      },
    })
    const session = await prisma.session.create({
      data: {
        userId: operator.id,
        familyId: randomUUID(),
        refreshToken: randomUUID(),
        lastAuthAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    })
    targetId = (
      await prisma.user.create({
        data: {
          email: 'recipient@e2e.amcore.test',
          emailCanonical: 'recipient@e2e.amcore.test',
          passwordHash: 'fixture-hash',
          locale: 'ru',
        },
      })
    ).id
    actor = { type: 'jwt', sub: operator.id, sid: session.id, systemRole: 'SUPER_ADMIN' }
    bearer = signAccessToken(app, { ...actor })
  })

  it('uses fixed HTTP contracts and prepares without issuing a token or sending', async () => {
    await request(app.getHttpServer()).get(route()).expect(401)
    const status = await request(app.getHttpServer())
      .get(route())
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200)
    expect(status.headers['cache-control']).toBe('private, no-store')
    const prep = await request(app.getHttpServer())
      .post(`${route()}/prepare`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ kind: 'password_recovery' })
      .expect(201)
    expect(prep.body.recipient).toBe('recipient@e2e.amcore.test')
    expect(await prisma.passwordResetToken.count()).toBe(0)
    expect(providerSend).not.toHaveBeenCalled()
    const send = await request(app.getHttpServer())
      .post(`${route()}/${prep.body.attemptId}/send`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200)
    expect(supportMailReceiptSchema.parse(send.body)).toMatchObject({
      outcome: 'simulated',
      tokenIssued: true,
    })
    await request(app.getHttpServer())
      .get(`${route()}/${prep.body.attemptId}`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200)
    expect(providerSend).toHaveBeenCalledTimes(1)
    expect(captured[0]!.html).toContain('/ru/reset-password?token=')
    const audit = await prisma.auditLog.findMany({
      where: { action: { startsWith: 'admin.user.support_mail_' } },
    })
    expect(audit.map((r) => r.action).sort()).toEqual([
      'admin.user.support_mail_dispatching',
      'admin.user.support_mail_requested',
      'admin.user.support_mail_settled',
    ])
    expect(JSON.stringify(audit)).not.toMatch(/token=|tokenHash|resetUrl|recipient@/)
  })

  it('preserves uniform public recovery and lets a passwordless mailbox owner establish a password', async () => {
    await prisma.user.update({ where: { id: targetId }, data: { passwordHash: null } })
    const known = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'recipient@e2e.amcore.test' })
      .expect(200)
    const unknown = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'absent@e2e.amcore.test' })
      .expect(200)
    expect(known.body).toEqual(unknown.body)
    const message = captured.find((mail) => mail.to === 'recipient@e2e.amcore.test')
    const rawToken = `${message?.text} ${message?.html}`.match(
      /reset-password\?token=([a-f0-9]{64})/
    )?.[1]
    if (!rawToken) throw new Error('Rendered reset token missing; private payload omitted')
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: rawToken, password: 'PasswordlessOwner123!' })
      .expect(204)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: targetId } })
    expect(Boolean(user.passwordHash)).toBe(true)
    expect(user.emailVerified).toBe(true)
    expect(
      await prisma.passwordResetToken.count({ where: { userId: targetId, used: false } })
    ).toBe(0)
  })

  it('replays an existing attempt before quota or freshness and never sends twice', async () => {
    const prep = await service.prepare(actor, targetId, 'password_recovery')
    const results = await Promise.all([
      dispatch.run(actor, targetId, prep.attemptId),
      dispatch.run(actor, targetId, prep.attemptId),
    ])
    expect(results.every((r) => r.evidence !== 'unconfirmed')).toBe(true)
    expect(providerSend).toHaveBeenCalledTimes(1)
    await prisma.session.update({ where: { id: actor.sid! }, data: { lastAuthAt: new Date(0) } })
    expect(await dispatch.run(actor, targetId, prep.attemptId)).toMatchObject({
      outcome: 'simulated',
    })
    expect(providerSend).toHaveBeenCalledTimes(1)
    const next = await service.prepare(actor, targetId, 'email_verification')
    await expect(dispatch.run(actor, targetId, next.attemptId)).rejects.toMatchObject({
      errorCode: AuthErrorCode.STEP_UP_REQUIRED,
    })
    expect(await prisma.emailVerificationToken.count()).toBe(0)
  })

  it('binds actor, target, recipient, kind and policy and rechecks current role/session', async () => {
    const prep = await service.prepare(actor, targetId, 'password_recovery')
    const other = { ...actor, sub: targetId }
    await expect(dispatch.receipt(other, targetId, prep.attemptId)).rejects.toThrow()
    await expect(dispatch.receipt(actor, actor.sub, prep.attemptId)).rejects.toThrow()
    await prisma.user.update({
      where: { id: targetId },
      data: { emailCanonical: 'changed@e2e.amcore.test' },
    })
    await expect(dispatch.run(actor, targetId, prep.attemptId)).rejects.toMatchObject({
      errorCode: SupportMailErrorCode.SUPPORT_MAIL_BINDING_CHANGED,
    })
    await prisma.user.update({
      where: { id: targetId },
      data: { emailCanonical: 'recipient@e2e.amcore.test' },
    })
    await prisma.session.update({ where: { id: actor.sid! }, data: { revokedAt: new Date() } })
    await expect(dispatch.run(actor, targetId, prep.attemptId)).rejects.toThrow()
    await prisma.session.update({ where: { id: actor.sid! }, data: { revokedAt: null } })
    await prisma.user.update({ where: { id: actor.sub }, data: { systemRole: 'USER' } })
    await expect(dispatch.run(actor, targetId, prep.attemptId)).rejects.toThrow()
    expect(await prisma.passwordResetToken.count()).toBe(0)
    expect(providerSend).not.toHaveBeenCalled()
  })

  it('rejects verified/passwordless targets, scoped principals and expired preparations without issuance', async () => {
    await prisma.user.update({
      where: { id: targetId },
      data: { emailVerified: true, passwordHash: null },
    })
    for (const kind of ['email_verification', 'password_recovery'] as const)
      await expect(service.prepare(actor, targetId, kind)).rejects.toMatchObject({
        errorCode: SupportMailErrorCode.SUPPORT_MAIL_NOT_ELIGIBLE,
      })
    await expect(
      service.status({ ...actor, organizationId: 'organization' }, targetId)
    ).rejects.toThrow()
    await expect(service.status({ ...actor, sid: undefined }, targetId)).rejects.toThrow()
    const prep = await service.prepare(actor, actor.sub, 'password_recovery')
    await prisma.supportMailAttempt.update({
      where: { id: prep.attemptId },
      data: { prepareExpiresAt: new Date(0) },
    })
    await expect(dispatch.run(actor, actor.sub, prep.attemptId)).rejects.toMatchObject({
      errorCode: SupportMailErrorCode.SUPPORT_MAIL_ATTEMPT_EXPIRED,
    })
    expect(await prisma.passwordResetToken.count()).toBe(0)
  })

  it('fails closed before issuance for production mock and unsupported adapters', async () => {
    const env = app.get(EnvService)
    const get = env.get.bind(env)
    const read = jest
      .spyOn(env, 'get')
      .mockImplementation(((key: string) =>
        key === 'NODE_ENV' ? 'production' : get(key as never)) as typeof env.get)
    await expect(service.prepare(actor, targetId, 'password_recovery')).rejects.toMatchObject({
      errorCode: SupportMailErrorCode.SUPPORT_MAIL_UNAVAILABLE,
    })
    read.mockRestore()
    jest.spyOn(app.get(EmailService), 'supportsDirectSecretFence', 'get').mockReturnValue(false)
    await expect(service.prepare(actor, targetId, 'password_recovery')).rejects.toMatchObject({
      errorCode: SupportMailErrorCode.SUPPORT_MAIL_UNAVAILABLE,
    })
    expect(await prisma.passwordResetToken.count()).toBe(0)
  })

  it.each(['requested', 'dispatching'] as const)(
    'does not send if strict %s audit cannot commit',
    async (event) => {
      const prep = await service.prepare(actor, targetId, 'password_recovery')
      const audit = app.get(AuditLogService)
      const record = audit.record.bind(audit)
      jest.spyOn(audit, 'record').mockImplementation((entry, options) => {
        if (entry.action === `admin.user.support_mail_${event}`)
          return Promise.reject(new Error('audit unavailable'))
        return record(entry, options)
      })
      const result = await dispatch
        .run(actor, targetId, prep.attemptId)
        .catch((error: unknown) => error)
      expect(result).toMatchObject(
        event === 'requested'
          ? { message: 'audit unavailable' }
          : { outcome: 'not_started', tokenIssued: true }
      )
      expect(await prisma.passwordResetToken.count()).toBe(event === 'requested' ? 0 : 1)
      expect(providerSend).not.toHaveBeenCalled()
    }
  )

  it('keeps issuance facts after render failure and reads two independent latest attempts', async () => {
    jest
      .spyOn(app.get(EmailService), 'renderTemplate')
      .mockRejectedValue(new Error('secret renderer payload'))
    for (const kind of ['email_verification', 'password_recovery'] as const) {
      const prep = await service.prepare(actor, targetId, kind)
      expect(await dispatch.run(actor, targetId, prep.attemptId)).toMatchObject({
        kind,
        outcome: 'not_started',
        reason: 'render_failed',
        tokenIssued: true,
      })
    }
    const status = await service.status(actor, targetId)
    expect(status.actions.every((a) => a.latest?.outcome === 'not_started')).toBe(true)
    expect(JSON.stringify(status)).not.toContain('secret renderer payload')
    expect(providerSend).not.toHaveBeenCalled()
    await prisma.user.update({
      where: { id: targetId },
      data: { emailVerified: true, passwordHash: null },
    })
    const ineligible = await service.status(actor, targetId)
    expect(ineligible.actions.map((action) => action.unavailableReason)).toEqual([
      'already_verified',
      'no_password',
    ])
    expect(ineligible.actions.map((action) => action.retryAfterSeconds)).toEqual([0, 0])
  })

  it('does not turn a read-first overdue result into a late accepted result', async () => {
    const prep = await service.prepare(actor, targetId, 'password_recovery')
    const entered = deferred(),
      finish = deferred()
    providerSend.mockImplementationOnce(async (params: SendEmailParams) => {
      params.beforeTransport?.()
      entered.resolve()
      await finish.promise
      return { id: 'mock-fixture-ack', success: true }
    })
    const running = dispatch.run(actor, targetId, prep.attemptId)
    await entered.promise
    await prisma.supportMailAttempt.update({
      where: { id: prep.attemptId },
      data: { deadlineAt: new Date(0) },
    })
    const rowLocked = deferred(),
      releaseRead = deferred()
    const reader = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.support_mail_attempts WHERE id=${prep.attemptId}::uuid FOR SHARE`
      rowLocked.resolve()
      await releaseRead.promise
    })
    await rowLocked.promise
    const observed = await dispatch.receipt(actor, targetId, prep.attemptId)
    expect(observed).toMatchObject({ evidence: 'derived', outcome: 'unknown' })
    finish.resolve()
    releaseRead.resolve()
    await reader
    await running
    expect(await dispatch.receipt(actor, targetId, prep.attemptId)).toMatchObject({
      outcome: 'unknown',
    })
  })

  it('waits for a settlement-first commit and reads its accepted fact after the deadline', async () => {
    const prep = await service.prepare(actor, targetId, 'password_recovery')
    const holdingCommit = deferred(),
      commit = deferred()
    const audit = app.get(AuditLogService),
      record = audit.record.bind(audit)
    let deadline = new Date(0)
    jest.spyOn(audit, 'record').mockImplementation(async (entry, options) => {
      await record(entry, options)
      if (entry.action === 'admin.user.support_mail_settled') {
        const row = await options!.tx!.supportMailAttempt.findUniqueOrThrow({
          where: { id: prep.attemptId },
        })
        deadline = row.deadlineAt!
        holdingCommit.resolve()
        await commit.promise
      }
    })
    // Shorten only the persisted deadline after transport admission, before settlement.
    providerSend.mockImplementationOnce(async (params: SendEmailParams) => {
      params.beforeTransport?.()
      await prisma.supportMailAttempt.update({
        where: { id: prep.attemptId },
        data: { deadlineAt: new Date(Date.now() + 150) },
      })
      return { id: 'mock-fixture-ack', success: true }
    })
    const running = dispatch.run(actor, targetId, prep.attemptId)
    await holdingCommit.promise
    let readDone = false
    const reading = dispatch.receipt(actor, targetId, prep.attemptId).then((r) => {
      readDone = true
      return r
    })
    await waitForEmailCondition(async () => {
      const [clock] = await prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      return clock!.now >= deadline
    }, 'settlement deadline')
    expect(readDone).toBe(false)
    commit.resolve()
    await running
    expect(await reading).toMatchObject({ evidence: 'stored', outcome: 'simulated' })
  })

  it.each(['role', 'session'])(
    'refuses transport when current %s changes while rendering',
    async (change) => {
      const prep = await service.prepare(actor, targetId, 'password_recovery')
      const entered = deferred(),
        resume = deferred()
      const email = app.get(EmailService),
        render = email.renderTemplate.bind(email)
      jest.spyOn(email, 'renderTemplate').mockImplementation(async (...args) => {
        entered.resolve()
        await resume.promise
        return render(...args)
      })
      const sending = dispatch.run(actor, targetId, prep.attemptId)
      await entered.promise
      if (change === 'role')
        await prisma.user.update({ where: { id: actor.sub }, data: { systemRole: 'USER' } })
      else
        await prisma.session.update({ where: { id: actor.sid! }, data: { revokedAt: new Date() } })
      resume.resolve()
      await sending
      expect(providerSend).not.toHaveBeenCalled()
      const row = await prisma.supportMailAttempt.findUniqueOrThrow({
        where: { id: prep.attemptId },
      })
      expect(row.tokenIssuedAt).not.toBeNull()
      expect(row.purgeAfter.getTime() - row.claimedAt!.getTime()).toBe(604800000)
      expect(
        await prisma.auditLog.count({
          where: { action: 'admin.user.support_mail_dispatching', targetId },
        })
      ).toBe(0)
    }
  )

  it('bounds outstanding and globally retained preparations without issuing tokens', async () => {
    const prep = await service.prepare(actor, targetId, 'password_recovery')
    const row = await prisma.supportMailAttempt.findUniqueOrThrow({ where: { id: prep.attemptId } })
    await prisma.supportMailAttempt.createMany({
      data: Array.from({ length: 19 }, () => ({ ...row, id: randomUUID() })),
    })
    await expect(service.prepare(actor, targetId, 'password_recovery')).rejects.toMatchObject({
      errorCode: SupportMailErrorCode.SUPPORT_MAIL_LIMIT,
    })
    await prisma.supportMailAttempt.updateMany({ data: { prepareExpiresAt: new Date(0) } })
    await prisma.supportMailAttempt.createMany({
      data: Array.from({ length: 9980 }, () => ({
        ...row,
        id: randomUUID(),
        actorUserId: 'another-actor',
        prepareExpiresAt: new Date(0),
      })),
    })
    await expect(service.prepare(actor, targetId, 'password_recovery')).rejects.toMatchObject({
      errorCode: SupportMailErrorCode.SUPPORT_MAIL_UNAVAILABLE,
    })
    expect(await prisma.passwordResetToken.count()).toBe(0)
    expect(providerSend).not.toHaveBeenCalled()
  })

  it('bounds cleanup at 1000 eligible rows and preserves active/retained receipts', async () => {
    const prep = await service.prepare(actor, targetId, 'password_recovery')
    const row = await prisma.supportMailAttempt.findUniqueOrThrow({ where: { id: prep.attemptId } })
    await prisma.supportMailAttempt.createMany({
      data: Array.from({ length: 1002 }, () => ({
        ...row,
        id: randomUUID(),
        prepareExpiresAt: new Date(0),
      })),
    })
    const result = await app.get(CleanupService).runCleanup()
    expect(result.expiredSupportMailAttempts).toBe(1000)
    expect(await prisma.supportMailAttempt.count()).toBe(3)
    expect(
      await prisma.supportMailAttempt.findUnique({ where: { id: prep.attemptId } })
    ).not.toBeNull()
    await app.get(CleanupService).runCleanup()
    expect(await prisma.supportMailAttempt.count()).toBe(1)
  })
})
