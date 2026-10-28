import { randomUUID } from 'node:crypto'

import { mockDeep } from 'jest-mock-extended'

import type { RequestPrincipal } from '@amcore/shared'

import type { EnvService } from '../../../env/env.service'
import type { PrismaClient, SupportMailAttempt } from '../../../generated/prisma/client'
import type { EmailService } from '../../../infrastructure/email/email.service'
import type { AuditLogService } from '../../audit/audit-log.service'
import type { AuthMailLimiter } from '../../auth/auth-mail-limiter.service'
import type { TokenManagerService } from '../../auth/token-manager.service'

import { type MailUser, policyBinding, recipientBinding } from './support-mail.common'
import type { SupportMailStore } from './support-mail.store'
import { SupportMailDispatch } from './support-mail-dispatch.service'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('Support mail dispatch deadlines and one physical transport', () => {
  const actor = {
    type: 'jwt',
    sub: 'operator',
    sid: 'session',
    systemRole: 'SUPER_ADMIN',
  } as RequestPrincipal
  const user: MailUser = {
    id: 'recipient',
    email: 'recipient@example.test',
    emailCanonical: 'recipient@example.test',
    locale: 'ru',
    name: null,
    passwordHash: 'fixture',
    emailVerified: false,
    systemRole: 'USER',
  }
  let rows: Map<string, SupportMailAttempt>
  let tx: ReturnType<typeof mockDeep<PrismaClient>>
  let service: SupportMailDispatch
  let env: EnvService
  let email: {
    supportsDirectSecretFence: boolean
    renderTemplate: jest.Mock
    sendDirectSecret: jest.Mock
  }
  let audit: { record: jest.Mock }
  let reserve: jest.Mock
  let admit: jest.Mock
  let transaction: jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    rows = new Map()
    tx = mockDeep<PrismaClient>()
    tx.user.findUnique.mockResolvedValue({
      id: actor.sub,
      systemRole: actor.systemRole,
      mfaAccount: null,
      mfaFactor: null,
    } as never)
    tx.mfaProtocol.findUnique.mockResolvedValue({ state: 'prepared', version: 1 } as never)
    ;(tx.$queryRaw as jest.Mock).mockImplementation(async () => [{ now: new Date() }])
    tx.session.findUnique.mockResolvedValue({
      lastAuthAt: new Date(),
      userId: actor.sub,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600000),
    } as never)
    ;(tx.supportMailAttempt.findUnique as jest.Mock).mockImplementation(async ({ where }) =>
      rows.get(where.id)
    )
    ;(tx.supportMailAttempt.update as jest.Mock).mockImplementation(async ({ where, data }) => {
      const row = { ...rows.get(where.id)!, ...data }
      rows.set(where.id, row)
      return { ...row }
    })
    tx.passwordResetToken.findUnique.mockResolvedValue({
      used: false,
      expiresAt: new Date(Date.now() + 900000),
    } as never)
    const values: Record<string, unknown> = {
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'mock',
      EMAIL_FROM: 'sender@example.test',
      FRONTEND_URL: 'https://site.example.test',
      PRODUCT_ADMIN_ORIGIN: undefined,
      STEP_UP_MAX_AGE_SECONDS: 300,
      PASSWORD_RESET_EXPIRY_MINUTES: 15,
      EMAIL_VERIFICATION_EXPIRY_HOURS: 48,
    }
    env = { get: (key: string) => values[key] } as EnvService
    reserve = jest.fn().mockResolvedValue(undefined)
    audit = { record: jest.fn().mockResolvedValue(undefined) }
    admit = jest.fn().mockResolvedValue(user)
    transaction = jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
    const store = {
      transaction,
      admit,
      attempt: async (_tx: unknown, _actor: unknown, _target: unknown, id: string) => ({
        ...rows.get(id)!,
      }),
    } as unknown as SupportMailStore
    email = {
      supportsDirectSecretFence: true,
      renderTemplate: jest
        .fn()
        .mockResolvedValue({ subject: 'subject', html: 'body', text: 'body' }),
      sendDirectSecret: jest.fn(async (_params, _template, fence) => {
        try {
          fence()
        } catch {
          return { outcome: 'not_started', reason: 'precheck' }
        }
        return { outcome: 'simulated', reason: null }
      }),
    }
    const tokens = {
      generatePasswordResetToken: jest.fn().mockResolvedValue({
        id: 'token-row',
        token: '<fake-secret-token>',
        expiresAt: new Date(Date.now() + 900000),
      }),
    }
    service = new SupportMailDispatch(
      store,
      env,
      tokens as unknown as TokenManagerService,
      { reserve } as unknown as AuthMailLimiter,
      email as unknown as EmailService,
      audit as unknown as AuditLogService
    )
  })
  afterEach(() => jest.useRealTimers())
  function prepare(): string {
    const id = randomUUID(),
      now = new Date()
    rows.set(id, {
      id,
      actorUserId: actor.sub,
      targetUserId: user.id,
      kind: 'password_recovery',
      recipientBinding: recipientBinding(user),
      policyBinding: policyBinding(env),
      provider: 'mock',
      state: 'prepared',
      ownerNonce: null,
      reason: null,
      tokenId: null,
      preparedAt: now,
      prepareExpiresAt: new Date(+now + 1800000),
      claimedAt: null,
      tokenIssuedAt: null,
      deadlineAt: null,
      dispatchAt: null,
      settledAt: null,
      readUntil: new Date(+now + 1800000),
      purgeAfter: new Date(+now + 604800000),
    })
    return id
  }
  const flush = () => jest.advanceTimersByTimeAsync(0)

  it('keeps both physical slots occupied after logical timeout until ignored render cancellation settles', async () => {
    const render = deferred<{ subject: string; html: string; text: string }>()
    email.renderTemplate.mockReturnValue(render.promise)
    const first = service.run(actor, user.id, prepare()),
      second = service.run(actor, user.id, prepare())
    await flush()
    await jest.advanceTimersByTimeAsync(15000)
    expect(await first).toMatchObject({ outcome: 'not_started', tokenIssued: true })
    expect(await second).toMatchObject({ outcome: 'not_started', tokenIssued: true })
    const third = prepare()
    await expect(service.run(actor, user.id, third)).rejects.toThrow()
    expect(reserve).toHaveBeenCalledTimes(2)
    render.resolve({ subject: 'late', html: 'late', text: 'late' })
    await flush()
    expect(email.sendDirectSecret).not.toHaveBeenCalled()
    email.renderTemplate.mockResolvedValue({ subject: 'new', html: 'new', text: 'new' })
    expect(await service.run(actor, user.id, third)).toMatchObject({ outcome: 'simulated' })
  })

  it('retains a stuck provider slot and never changes terminal unknown after its late acceptance', async () => {
    const provider = deferred<{ outcome: string; reason: null }>()
    email.sendDirectSecret.mockImplementation((_params, _template, fence) => {
      fence()
      return provider.promise
    })
    const id = prepare(),
      running = service.run(actor, user.id, id)
    await flush()
    await jest.advanceTimersByTimeAsync(15000)
    expect(await running).toMatchObject({ outcome: 'unknown' })
    provider.resolve({ outcome: 'simulated', reason: null })
    await flush()
    expect(await service.receipt(actor, user.id, id)).toMatchObject({ outcome: 'unknown' })
    expect(await service.run(actor, user.id, id)).toMatchObject({ outcome: 'unknown' })
    expect(email.sendDirectSecret).toHaveBeenCalledTimes(1)
  })

  it.each([249, 250, 251])(
    'admits transport only below the final fence boundary (%i ms)',
    async (delay) => {
      let physicalCalls = 0
      email.sendDirectSecret.mockImplementation(async (_params, _template, fence) => {
        jest.advanceTimersByTime(delay)
        try {
          fence()
        } catch {
          return { outcome: 'not_started', reason: 'precheck' }
        }
        physicalCalls++
        return { outcome: 'simulated', reason: null }
      })
      expect(await service.run(actor, user.id, prepare())).toMatchObject({
        outcome: delay < 250 ? 'simulated' : 'not_started',
      })
      expect(physicalCalls).toBe(delay < 250 ? 1 : 0)
    }
  )

  it('includes fence database time in the final admission age', async () => {
    admit.mockImplementation(async () => {
      if (admit.mock.calls.length === 3) jest.advanceTimersByTime(250)
      return user
    })
    expect(await service.run(actor, user.id, prepare())).toMatchObject({ outcome: 'not_started' })
  })

  it('refuses a superseded token and never lets renderer/provider text enter receipts or audit', async () => {
    tx.passwordResetToken.findUnique.mockResolvedValue({
      used: true,
      expiresAt: new Date(Date.now() + 1000),
    } as never)
    expect(await service.run(actor, user.id, prepare())).toMatchObject({
      outcome: 'not_started',
      tokenIssued: true,
    })
    expect(email.sendDirectSecret).not.toHaveBeenCalled()
    email.renderTemplate.mockRejectedValue(new Error('hostile-token-and-mail-body'))
    const result = await service.run(actor, user.id, prepare())
    expect(result).toMatchObject({ outcome: 'not_started', reason: 'render_failed' })
    expect(JSON.stringify([result, audit.record.mock.calls])).not.toContain(
      'hostile-token-and-mail-body'
    )
  })

  it('does not send after a claim acknowledgment is lost', async () => {
    audit.record.mockRejectedValueOnce(new Error('claim commit unavailable'))
    await expect(service.run(actor, user.id, prepare())).rejects.toThrow()
    expect(email.renderTemplate).not.toHaveBeenCalled()
    expect(email.sendDirectSecret).not.toHaveBeenCalled()
  })

  it.each([2, 3, 4])(
    'keeps conservative facts after commit %i acknowledgment is lost',
    async (lost) => {
      let count = 0
      transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => {
        const call = ++count
        const committed = await fn(tx)
        if (call === lost) throw new Error('committed but acknowledgment lost')
        return committed
      })
      const id = prepare()
      const result = await service.run(actor, user.id, id).catch(() => undefined)
      const sent = lost === 4 ? 1 : 0
      expect(email.sendDirectSecret).toHaveBeenCalledTimes(sent)
      expect(rows.get(id)?.tokenIssuedAt).not.toBeNull()
      expect(result === undefined).toBe(lost === 2)
      if (lost === 2) await jest.advanceTimersByTimeAsync(15000)
      const receipt = await service.receipt(actor, user.id, id)
      expect(receipt).toMatchObject({
        outcome: lost === 2 ? 'not_started' : lost === 3 ? 'unknown' : 'simulated',
        tokenIssued: true,
      })
      await service.run(actor, user.id, id)
      expect(reserve).toHaveBeenCalledTimes(1)
      expect(email.sendDirectSecret).toHaveBeenCalledTimes(sent)
    }
  )

  it('does not issue a token or render after an unconfirmed quota reservation', async () => {
    reserve.mockRejectedValue(new Error('reservation reply lost'))
    const id = prepare()
    await expect(service.run(actor, user.id, id)).rejects.toThrow('reservation reply lost')
    expect(await service.receipt(actor, user.id, id)).toMatchObject({
      evidence: 'unconfirmed',
      tokenIssued: false,
    })
    expect(email.renderTemplate).not.toHaveBeenCalled()
    expect(email.sendDirectSecret).not.toHaveBeenCalled()
  })

  it('rejects an old delayed callback after another attempt completes', async () => {
    const resume = deferred<void>()
    let physicalCalls = 0
    let oldCallbackRefused = false
    email.sendDirectSecret.mockImplementationOnce(async (_params, _template, fence) => {
      await resume.promise
      try {
        fence()
        physicalCalls++
      } catch {
        oldCallbackRefused = true
      }
      return { outcome: 'not_started', reason: 'precheck' }
    })
    const first = prepare(),
      running = service.run(actor, user.id, first)
    await flush()
    await jest.advanceTimersByTimeAsync(15000)
    expect(await running).toMatchObject({ outcome: 'unknown' })
    email.sendDirectSecret.mockImplementation(async (_params, _template, fence) => {
      fence()
      physicalCalls++
      return { outcome: 'simulated', reason: null }
    })
    expect(await service.run(actor, user.id, prepare())).toMatchObject({ outcome: 'simulated' })
    resume.resolve()
    await flush()
    expect(oldCallbackRefused).toBe(true)
    expect(physicalCalls).toBe(1)
    expect(await service.receipt(actor, user.id, first)).toMatchObject({ outcome: 'unknown' })
  })

  it('returns unconfirmed when a saved result cannot be read and recovers it through GET', async () => {
    const id = prepare()
    admit.mockImplementation(async () => {
      if (admit.mock.calls.length === 4) throw new Error('receipt temporarily unavailable')
      return user
    })
    expect(await service.run(actor, user.id, id)).toEqual({
      evidence: 'unconfirmed',
      attemptId: id,
      tokenIssued: true,
    })
    expect(await service.receipt(actor, user.id, id)).toMatchObject({
      evidence: 'stored',
      outcome: 'simulated',
    })
    expect(email.sendDirectSecret).toHaveBeenCalledTimes(1)
  })
})
