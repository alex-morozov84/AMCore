import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import * as argon2 from 'argon2'

import type { LoginRateLimiterService } from '../src/core/auth/login-rate-limiter.service.js'
import { continuationHash, type FlowRequest } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { flowData } from '../src/core/auth/mfa/mfa-flow-state.js'
import { MfaPasswordVerificationService } from '../src/core/auth/mfa/mfa-password-verification.service.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import type { MfaSourceLimiterService } from '../src/core/auth/mfa/mfa-source-limiter.service.js'
import { lockMfaAccounts, mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'
import { verificationFixture } from './mfa-verification.fixture.js'

const password = '<fake-password-for-isolated-MFA-fixture>'

describe('Password proof outside locks with exact authority recheck', () => {
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

  async function prepared() {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    await db.user.update({ where: { id: f.user.id }, data: { passwordHash: hash } })
    const credential = mfaCredential()
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: {
        credentialHash: continuationHash(credential)!,
        browserContextId: f.requestBinding.contextId,
        publicationGeneration: 1,
        data: {
          proofs: {
            primary: null,
            secondFactor: {
              eventId: randomUUID(),
              method: 'totp',
              factorVersion: 1,
              verifiedAt: f.family.mfaAt!.toISOString(),
              origin: { kind: 'family', familyId: f.family.id },
            },
          },
        },
      },
    })
    const request: FlowRequest = {
      credential,
      purpose: 'reauthenticate',
      audience: 'product',
      bindingHash: f.requestBinding.bindingHash,
      browser: f.requestBinding,
    }
    const login = {
      check: jest.fn(async () => undefined),
      consume: jest.fn(async () => undefined),
      reset: jest.fn(async () => undefined),
    }
    const source = { consume: jest.fn(async () => undefined) }
    const service = new MfaPasswordVerificationService(
      db as unknown as PrismaService,
      login as unknown as LoginRateLimiterService,
      source as unknown as MfaSourceLimiterService,
      verificationFixture(fixture).events
    )
    return { ...f, request, login, source, service }
  }

  it('persists a bounded local password event once and keeps MFA failure history', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    await db.mfaAttemptBudget.create({ data: { userId: f.user.id, failures: [Date.now()] } })
    const operationId = randomUUID()
    expect(await f.service.submit(f.request, operationId, password, 'source')).toEqual({
      outcome: 'verified',
      requiredProofs: [],
    })
    const original = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })
    expect(
      await f.service.submit(f.request, operationId, 'different-retry-password', 'source')
    ).toEqual({ outcome: 'verified', requiredProofs: [] })
    expect((await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })).data).toEqual(
      original.data
    )
    expect(f.login.check).toHaveBeenCalledTimes(1)
    expect(f.login.reset).toHaveBeenCalledTimes(1)
    expect(f.login.consume).not.toHaveBeenCalled()
    expect(
      (await db.mfaAttemptBudget.findUniqueOrThrow({ where: { userId: f.user.id } })).failures
    ).toHaveLength(1)
    expect(JSON.stringify(original)).not.toContain(password)
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      primaryProofId: f.family.primaryProofId,
    })
  })

  it('keeps a stale second factor pending under the recorded shorter reauthentication window', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const flow = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })
    await db.mfaFlow.update({
      where: { id: flow.id },
      data: {
        data: {
          ...flowData(flow.data),
          proofWindowSeconds: 60,
        },
      },
    })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: {
        mfaAt: new Date((await mfaDatabaseClock(db)).getTime() - 61_000),
      },
    })
    await expect(f.service.submit(f.request, randomUUID(), password, 'source')).resolves.toEqual({
      outcome: 'verified',
      requiredProofs: ['second_factor'],
    })
  })

  it('dates the proof before external password work starts', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    let passwordWorkAt: Date | undefined
    f.login.check.mockImplementationOnce(async () => {
      passwordWorkAt = await mfaDatabaseClock(db)
    })
    expect((await f.service.submit(f.request, randomUUID(), password, 'source')).outcome).toBe(
      'verified'
    )
    const flow = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })
    const data = flow.data as { proofs: { primary: { verifiedAt: string } } }
    expect(passwordWorkAt).toBeDefined()
    expect(new Date(data.proofs.primary.verifiedAt).getTime()).toBeLessThanOrEqual(
      passwordWorkAt!.getTime()
    )
  })

  it('records a wrong password once through existing password semantics without a factor failure', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const operationId = randomUUID()
    expect(
      (await f.service.submit(f.request, operationId, 'wrong-password', 'source')).outcome
    ).toBe('wrong_password')
    expect(
      (await f.service.submit(f.request, operationId, 'wrong-password', 'source')).outcome
    ).toBe('wrong_password')
    expect(f.login.consume).toHaveBeenCalledTimes(1)
    expect(f.login.reset).not.toHaveBeenCalled()
    expect(await db.mfaFlow.findUnique({ where: { id: f.flow.id } })).toMatchObject({ attempts: 0 })
    expect(await db.mfaAttemptBudget.findUnique({ where: { userId: f.user.id } })).toBeNull()
    expect(
      await db.auditLog.count({ where: { actorId: f.user.id, action: 'auth.step_up_failed' } })
    ).toBe(1)
  })

  it.each(['hash', 'source'] as const)(
    'rechecks %s changes after password work with no account lock held',
    async (change) => {
      const db = fixture.clients[1]!
      const f = await prepared()
      f.login.reset.mockImplementationOnce(async () => {
        await db.$transaction(
          async (tx) => {
            const now = await lockMfaAccounts(tx, [f.user.id])
            if (change === 'hash')
              await tx.user.update({
                where: { id: f.user.id },
                data: { passwordHash: 'changed-during-password-work' },
              })
            else
              await tx.authSessionFamily.update({
                where: { id: f.family.id },
                data: { revokedAt: now },
              })
          },
          { maxWait: 2000, timeout: 4000 }
        )
      })
      expect(await f.service.submit(f.request, randomUUID(), password, 'source')).toEqual({
        outcome: 'restart_required',
      })
      expect(await db.mfaOperation.count()).toBe(0)
      const flow = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })
      expect((flow.data as { proofs: { primary: unknown } }).proofs.primary).toBeNull()
    }
  )
})
