import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import * as argon2 from 'argon2'

import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { assertSessionFresh } from '../src/core/auth/session-freshness.js'
import { databaseSqlState } from '../src/core/organizations/establishment-error.js'

import { MfaProofFixture } from './mfa-proof.fixture.js'
import { passwordStepUpFixture } from './password-step-up.fixture.js'

const password = '<fake-existing-fixture-password>'

describe('Password-only step-up keeps exact family authority and reports incomplete MFA honestly', () => {
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

  it('commits only primary proof when the second factor is stale; no new token/family/code consumption', async () => {
    const f = await passwordStepUpFixture(fixture, hash)
    const db = fixture.clients[0]!
    const old = new Date((await mfaDatabaseClock(db)).getTime() - 601_000)
    await db.authSessionFamily.update({
      where: { id: f.operator.family.id },
      data: { primaryAt: old, mfaAt: old },
    })
    const signing = jest.spyOn(f.tokens, 'generateAccessToken')
    await expect(f.service.verify(f.principal, password, 'fixture-source')).resolves.toEqual({
      kind: 'proof_required',
      requiredProofs: ['second_factor'],
    })
    const family = await db.authSessionFamily.findUniqueOrThrow({
      where: { id: f.operator.family.id },
    })
    expect(family.primaryAt!.getTime()).toBeGreaterThan(old.getTime())
    expect(family.mfaAt).toEqual(old)
    expect(family.mfaProofId).toBe(f.operator.family.mfaProofId)
    expect(signing).not.toHaveBeenCalled()
    expect(await db.authSessionFamily.count()).toBe(1)
    expect(await db.session.count()).toBe(1)
    expect(await db.mfaFactor.findUnique({ where: { userId: f.operator.user.id } })).toMatchObject({
      lastAcceptedStep: 42n,
    })
    await expect(assertSessionFresh(db, 600, f.principal)).rejects.toMatchObject({
      errorCode: 'STEP_UP_REQUIRED',
      details: { requiredProofs: ['second_factor'] },
    })
  })

  it('retains fresh backup proof and the signed family after rotation removed the old SID', async () => {
    const f = await passwordStepUpFixture(fixture, hash)
    const db = fixture.clients[0]!
    f.principal.organizationId = 'fixture-organization-scope'
    f.principal.aclVersion = 7
    await db.mfaAccount.update({
      where: { userId: f.operator.user.id },
      data: { codeGeneration: 2 },
    })
    await db.authSessionFamily.update({
      where: { id: f.operator.family.id },
      data: { mfaMethod: 'recovery_code', recoveryGeneration: 1 },
    })
    await db.session.create({
      data: {
        userId: f.operator.user.id,
        familyId: f.operator.family.id,
        refreshToken: `fake-current-${randomUUID()}`,
        expiresAt: f.operator.family.expiresAt,
      },
    })
    await db.session.delete({ where: { id: f.operator.session.id } })
    const result = await f.service.verify(f.principal, password, 'fixture-source')
    expect(result).toHaveProperty('accessToken')
    const token = 'accessToken' in result ? result.accessToken : ''
    expect(f.jwt.verify(token)).toMatchObject({
      fid: f.operator.family.id,
      securityVersion: 3,
      browserBound: true,
      sid: f.operator.session.id,
      organizationId: 'fixture-organization-scope',
      aclVersion: 7,
    })
    expect(
      await db.authSessionFamily.findUnique({ where: { id: f.operator.family.id } })
    ).toMatchObject({
      mfaAt: f.operator.family.mfaAt,
      mfaProofId: f.operator.family.mfaProofId,
      mfaMethod: 'recovery_code',
      recoveryGeneration: 1,
    })
    expect(await db.authSessionFamily.count()).toBe(1)
  })

  it.each(['epoch', 'password', 'browser', 'family'] as const)(
    'refuses %s changed during password work',
    async (change) => {
      const f = await passwordStepUpFixture(fixture, hash)
      const db = fixture.clients[0]!
      const signing = jest.spyOn(f.tokens, 'generateAccessToken')
      f.limiter.check.mockImplementation(async () => {
        if (change === 'epoch')
          await db.mfaAccount.update({
            where: { userId: f.operator.user.id },
            data: { securityVersion: { increment: 1 } },
          })
        if (change === 'password')
          await db.user.update({
            where: { id: f.operator.user.id },
            data: { passwordHash: 'changed-fixture-hash' },
          })
        if (change === 'browser')
          await db.browserAuthContext.update({
            where: { id: f.operator.requestBinding.contextId },
            data: { generation: 2 },
          })
        if (change === 'family')
          await db.authSessionFamily.update({
            where: { id: f.operator.family.id },
            data: { revokedAt: await mfaDatabaseClock(db) },
          })
      })
      await expect(f.service.verify(f.principal, password, 'fixture-source')).rejects.toMatchObject(
        { errorCode: 'SESSION_CHANGED' }
      )
      expect(signing).not.toHaveBeenCalled()
      expect(
        await db.authSessionFamily.findUnique({ where: { id: f.operator.family.id } })
      ).toMatchObject({
        primaryAt: f.operator.family.primaryAt,
        primaryProofId: f.operator.family.primaryProofId,
      })
    }
  )

  it('rolls back proof changes when strict audit fails', async () => {
    const f = await passwordStepUpFixture(fixture, hash)
    const db = fixture.clients[0]!
    jest.spyOn(f.audit, 'record').mockRejectedValueOnce(new Error('controlled audit failure'))
    await expect(f.service.verify(f.principal, password, 'fixture-source')).rejects.toThrow(
      'controlled audit failure'
    )
    expect(await db.authSessionFamily.findUnique({ where: { id: f.operator.family.id } })).toEqual(
      f.operator.family
    )
    expect(await db.session.findUnique({ where: { id: f.operator.session.id } })).toEqual(
      f.operator.session
    )
  })

  it('consumes the password limiter on a wrong password without changing family evidence', async () => {
    const f = await passwordStepUpFixture(fixture, hash)
    const db = fixture.clients[0]!
    await expect(
      f.service.verify(f.principal, '<wrong-fixture-password>', 'fixture-source')
    ).rejects.toMatchObject({ errorCode: 'INVALID_CREDENTIALS' })
    expect(f.limiter.consume).toHaveBeenCalledTimes(1)
    expect(f.limiter.reset).not.toHaveBeenCalled()
    expect(await db.authSessionFamily.findUnique({ where: { id: f.operator.family.id } })).toEqual(
      f.operator.family
    )
  })

  it('does not freshen the pre-password proof clock after waiting past the route deadline', async () => {
    const f = await passwordStepUpFixture(fixture, hash, 2)
    const db = fixture.clients[0]!
    const originalAudit = f.audit.record.bind(f.audit)
    let recordedAt: Date | null = null
    jest.spyOn(f.audit, 'record').mockImplementation(async (entry, options) => {
      const family = await options!.tx!.authSessionFamily.findUniqueOrThrow({
        where: { id: f.operator.family.id },
      })
      recordedAt = family.primaryAt
      const deadline = new Date(recordedAt!.getTime() + 2100)
      await options!.tx!
        .$executeRaw`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (${deadline}::timestamptz - clock_timestamp()))))`
      return originalAudit(entry, options)
    })
    await expect(f.service.verify(f.principal, password, 'fixture-source')).resolves.toEqual({
      kind: 'proof_required',
      requiredProofs: ['password', 'second_factor'],
    })
    expect(recordedAt).not.toBeNull()
    expect(
      await db.authSessionFamily.findUnique({ where: { id: f.operator.family.id } })
    ).toMatchObject({ primaryAt: recordedAt })
  })

  it('bounds a blocked browser-context lock before attempting password work', async () => {
    const f = await passwordStepUpFixture(fixture, hash)
    const db = fixture.clients[0]!
    let unlock!: () => void
    let locked!: () => void
    const release = new Promise<void>((resolve) => {
      unlock = resolve
    })
    const ready = new Promise<void>((resolve) => {
      locked = resolve
    })
    const holder = fixture.clients[1]!.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${f.operator.requestBinding.contextId} FOR UPDATE`
        locked()
        await release
      },
      { timeout: 10000 }
    )
    await ready
    try {
      const error = await f.service.verify(f.principal, password, 'fixture-source').then(
        () => null,
        (error: unknown) => error
      )
      expect(error).toMatchObject({ code: 'P2010' })
      expect(databaseSqlState(error)).toBe('55P03')
      expect(f.limiter.check).not.toHaveBeenCalled()
      expect(
        await db.authSessionFamily.findUnique({ where: { id: f.operator.family.id } })
      ).toEqual(f.operator.family)
    } finally {
      unlock()
      await holder
    }
  })
})
