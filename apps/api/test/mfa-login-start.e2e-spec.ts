import { randomUUID } from 'node:crypto'

import * as argon2 from 'argon2'

import { lockMfaFlow } from '../src/core/auth/mfa/mfa-flow-lock.js'

import { loginStartFixture } from './mfa-login-start.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

const password = '<fake-isolated-login-password>'

describe('Password login reserves only after identity and current authority checks', () => {
  const fixture = new MfaProofFixture()
  let hash: string
  beforeAll(async () => {
    hash = await argon2.hash(password)
    await fixture.start()
  }, 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    const db = fixture.clients[0]!
    await db.user.deleteMany()
    await db.browserAuthContext.deleteMany()
    await db.mfaProtocol.upsert({
      where: { id: 'platform' },
      create: { id: 'platform', state: 'active' },
      update: { state: 'active', version: 1 },
    })
  })

  it('keeps the current browser and sessions when the password is wrong', async () => {
    const db = fixture.clients[0]!
    const f = await loginStartFixture(fixture, hash)
    expect(
      await f.service.password(
        f.user.email,
        'wrong',
        'source',
        {
          kind: 'browser',
          binding: f.requestBinding,
        },
        randomUUID()
      )
    ).toEqual({ kind: 'invalid_credentials' })
    expect(
      await db.browserAuthContext.findUnique({ where: { id: f.requestBinding.contextId } })
    ).toMatchObject({ generation: 1, currentFamilyId: f.family.id, state: 'published' })
    expect(await db.session.count()).toBe(1)
    expect(f.login.consume).toHaveBeenCalledTimes(1)
    expect(f.source.consume).not.toHaveBeenCalled()
  })

  it('reserves the next generation with a local password proof and no new session', async () => {
    const db = fixture.clients[0]!
    const f = await loginStartFixture(fixture, hash)
    const operationId = randomUUID()
    const result = await f.service.password(
      f.user.email,
      password,
      'source',
      {
        kind: 'browser',
        binding: f.requestBinding,
      },
      operationId
    )
    if (result.kind !== 'mfa') throw new Error('Expected MFA continuation')
    expect(result.request.browser?.generation).toBe(2)
    expect(result.setupRequired).toBe(false)
    expect(await db.session.count({ where: { revokedAt: null } })).toBe(0)
    expect(await db.session.count()).toBe(1)
    expect(await db.authSessionFamily.count()).toBe(1)
    expect(await db.$transaction((tx) => lockMfaFlow(tx, result.request))).not.toBeNull()
    const flow = await db.mfaFlow.findUniqueOrThrow({ where: { id: result.flowId } })
    expect(flow).toMatchObject({ authorityKind: 'identity', sourceFamilyId: null })
    expect(JSON.stringify(flow)).not.toContain(result.request.credential)
    expect(JSON.stringify(flow)).not.toContain(password)
    expect(f.source.consume).toHaveBeenCalledWith('start', 'source')
    expect(
      await f.service.password(
        f.user.email,
        password,
        'source',
        {
          kind: 'browser',
          binding: result.request.browser!,
        },
        operationId
      )
    ).toEqual({ kind: 'restart_required' })
    expect(await db.mfaFlow.count({ where: { authorityKind: 'identity' } })).toBe(1)
  })

  it.each(['hash', 'epoch'] as const)(
    'rejects a concurrent %s change before reserving',
    async (change) => {
      const db = fixture.clients[1]!
      const f = await loginStartFixture(fixture, hash)
      f.login.reset.mockImplementationOnce(async () => {
        if (change === 'hash')
          await db.user.update({
            where: { id: f.user.id },
            data: { passwordHash: 'changed-after-verification' },
          })
        else
          await db.mfaAccount.update({
            where: { userId: f.user.id },
            data: { securityVersion: { increment: 1 } },
          })
      })
      expect(
        await f.service.password(
          f.user.email,
          password,
          'source',
          {
            kind: 'browser',
            binding: f.requestBinding,
          },
          randomUUID()
        )
      ).toEqual({ kind: 'restart_required' })
      expect(
        await db.browserAuthContext.findUnique({ where: { id: f.requestBinding.contextId } })
      ).toMatchObject({ generation: 1, currentFamilyId: f.family.id })
      expect(await db.mfaOperation.count()).toBe(0)
    }
  )

  it('keeps ordinary direct login separate from protected source budgets', async () => {
    const db = fixture.clients[0]!
    const f = await loginStartFixture(fixture, hash, false)
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'prepared' } })
    const result = await f.service.password(
      f.user.email,
      password,
      'source',
      { kind: 'direct' },
      randomUUID()
    )
    if (result.kind !== 'ordinary') throw new Error('Expected ordinary login')
    expect(result.request.browser).toBeNull()
    expect(result.request.audience).toBe('direct')
    expect(await db.$transaction((tx) => lockMfaFlow(tx, result.request))).not.toBeNull()
    expect(f.source.consume).not.toHaveBeenCalled()
    expect(await db.session.count()).toBe(1)
  })

  it('requires the offline recovery ticket before generic continuation authority', async () => {
    const db = fixture.clients[0]!
    const f = await loginStartFixture(fixture, hash)
    await db.mfaAccount.update({ where: { userId: f.user.id }, data: { emergencyRequired: true } })
    const result = await f.service.password(
      f.user.email,
      password,
      'source',
      { kind: 'direct' },
      randomUUID()
    )
    if (result.kind !== 'recovery_ticket_required') throw new Error('Expected recovery gate')
    expect(result.setupRequired).toBe(true)
    expect(await db.$transaction((tx) => lockMfaFlow(tx, result.request))).toBeNull()
    expect(await db.mfaFlow.findUnique({ where: { id: result.flowId } })).toMatchObject({
      authorityKind: 'recovery_pending',
    })
    expect(await db.session.count()).toBe(1)
  })
})
