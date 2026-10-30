import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import { generate } from 'otplib'

import type { FlowRequest } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { continuationHash } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { flowData } from '../src/core/auth/mfa/mfa-flow-state.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { lockMfaAccounts, mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type { Prisma } from '../src/generated/prisma/client.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'
import { verificationFixture } from './mfa-verification.fixture.js'

async function prepared(fixture: MfaProofFixture) {
  const db = fixture.clients[0]!
  const f = await createAuthorityAccount(fixture)
  await db.user.update({ where: { id: f.user.id }, data: { emailVerified: true } })
  const credential = mfaCredential()
  await db.mfaFlow.update({
    where: { id: f.flow.id },
    data: {
      credentialHash: continuationHash(credential)!,
      browserContextId: f.requestBinding.contextId,
      publicationGeneration: f.requestBinding.generation,
      data: {
        proofs: {
          primary: {
            eventId: randomUUID(),
            method: 'password',
            verifiedAt: f.family.primaryAt!.toISOString(),
            origin: { kind: 'family', familyId: f.family.id },
          },
          secondFactor: null,
        },
      },
    },
  })
  const codes = await db.$transaction((tx) => fixture.first.replaceBackupCodes(tx, f.user.id, 3, 0))
  const request: FlowRequest = {
    credential,
    purpose: 'reauthenticate',
    audience: 'product',
    bindingHash: f.requestBinding.bindingHash,
    browser: f.requestBinding,
  }
  return { ...f, request, codes: codes!.codes }
}

describe('Factor verification and durable effects in one PostgreSQL transaction', () => {
  const fixture = new MfaProofFixture()
  beforeAll(() => fixture.start(), 120000)
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

  it('consumes once with one durable notification and replays no proof or plaintext', async () => {
    const db = fixture.clients[0]!
    const f = await prepared(fixture)
    const first = verificationFixture(fixture).service
    const second = verificationFixture(fixture, 1).service
    const operationId = randomUUID()
    const proof = { method: 'recovery_code', code: f.codes[0] }
    expect(await first.submit(f.request, operationId, proof, 'fixture-source')).toEqual({
      outcome: 'verified',
      requiredProofs: [],
    })
    const original = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })
    expect(await second.submit(f.request, operationId, proof, 'fixture-source')).toEqual({
      outcome: 'verified',
      requiredProofs: [],
    })
    expect((await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })).data).toEqual(
      original.data
    )
    expect(await db.mfaRecoveryCode.count({ where: { userId: f.user.id, consumedAt: null } })).toBe(
      9
    )
    expect(
      await db.auditLog.count({
        where: { actorId: f.user.id, action: 'auth.mfa_backup_code_used' },
      })
    ).toBe(1)
    const notifications = await db.notification.findMany({
      where: { recipientUserId: f.user.id },
      include: { deliveries: true },
    })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'in_app', status: 'DELIVERED' }),
        expect.objectContaining({ channel: 'email', status: 'PENDING' }),
      ])
    )
    expect(
      JSON.stringify([
        original,
        notifications,
        await db.mfaOperation.findMany(),
        await db.auditLog.findMany(),
      ])
    ).not.toContain(f.codes[0])
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      mfaProofId: f.family.mfaProofId,
    })
  })

  it('preserves the verified factor locally and requests an older primary proof under the shorter window', async () => {
    const db = fixture.clients[0]!
    const f = await prepared(fixture)
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
        primaryAt: new Date((await mfaDatabaseClock(db)).getTime() - 61_000),
      },
    })
    await expect(
      verificationFixture(fixture).service.submit(
        f.request,
        randomUUID(),
        {
          method: 'recovery_code',
          code: f.codes[0],
        },
        'source'
      )
    ).resolves.toEqual({ outcome: 'verified', requiredProofs: ['password'] })
    expect(
      await db.mfaRecoveryCode.count({ where: { userId: f.user.id, consumedAt: { not: null } } })
    ).toBe(1)
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      mfaAt: f.family.mfaAt,
      mfaProofId: f.family.mfaProofId,
    })
  })

  it('verifies an application code once across flows without creating a backup-use notification', async () => {
    const db = fixture.clients[0]!
    const f = await prepared(fixture)
    const service = verificationFixture(fixture).service
    const factor = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    const secret = fixture.codec.decrypt(f.user.id, factor.id, factor.keyId, factor.encryptedSeed)
    const now = await mfaDatabaseClock(db)
    const code = await generate({
      secret,
      epoch: Math.floor(now.getTime() / 1000),
      algorithm: 'sha1',
      digits: 6,
      period: 30,
    })
    const original = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })
    const credential = mfaCredential()
    const proofs = (original.data as { proofs: { primary: Prisma.JsonValue } }).proofs
    await db.mfaFlow.create({
      data: {
        ...original,
        id: undefined,
        credentialHash: continuationHash(credential)!,
        data: { proofs: { primary: proofs.primary as Prisma.InputJsonValue, secondFactor: null } },
      },
    })
    expect(
      (await service.submit(f.request, randomUUID(), { method: 'totp', code }, 'source')).outcome
    ).toBe('verified')
    expect(
      (
        await service.submit(
          { ...f.request, credential },
          randomUUID(),
          { method: 'totp', code },
          'source'
        )
      ).outcome
    ).toBe('wrong_code')
    expect(
      await db.auditLog.count({ where: { actorId: f.user.id, action: 'auth.mfa_proof_verified' } })
    ).toBe(1)
    expect(await db.notification.count()).toBe(0)
    expect(await db.mfaRecoveryCode.count({ where: { consumedAt: null } })).toBe(10)
  })

  it('commits malformed-code failures and deduplicates each wrong-code operation', async () => {
    const db = fixture.clients[0]!
    const f = await prepared(fixture)
    const service = verificationFixture(fixture).service
    const firstId = randomUUID()
    expect(
      await service.submit(f.request, firstId, { method: 'totp', code: 'invalid' }, 'source')
    ).toEqual({ outcome: 'wrong_code' })
    expect(
      (await service.submit(f.request, firstId, { method: 'totp', code: 'invalid' }, 'source'))
        .outcome
    ).toBe('wrong_code')
    for (let i = 1; i < 5; i++) {
      expect((await service.submit(f.request, randomUUID(), {}, 'source')).outcome).toBe(
        i === 4 ? 'attempts_exhausted' : 'wrong_code'
      )
    }
    expect(await db.mfaFlow.findUnique({ where: { id: f.flow.id } })).toMatchObject({
      state: 'attempts_exhausted',
      attempts: 5,
    })
    expect(
      (await db.mfaAttemptBudget.findUniqueOrThrow({ where: { userId: f.user.id } })).failures
    ).toHaveLength(5)
    expect(
      await db.auditLog.count({
        where: { actorId: f.user.id, action: 'auth.mfa_verification_failed' },
      })
    ).toBe(5)
    expect(await db.mfaRecoveryCode.count({ where: { consumedAt: null } })).toBe(10)
  })

  it('rolls back consumption, proof, operation and audit if notification intent cannot persist', async () => {
    const db = fixture.clients[0]!
    const f = await prepared(fixture)
    const { service, notifications } = verificationFixture(fixture)
    jest.spyOn(notifications, 'notifyTx').mockRejectedValueOnce(new Error('intent write failed'))
    const operationId = randomUUID()
    const proof = { method: 'recovery_code', code: f.codes[0] }
    await expect(service.submit(f.request, operationId, proof, 'source')).rejects.toThrow(
      'intent write failed'
    )
    expect(await db.mfaRecoveryCode.count({ where: { consumedAt: null } })).toBe(10)
    expect(await db.mfaOperation.count()).toBe(0)
    expect(await db.auditLog.count({ where: { actorId: f.user.id } })).toBe(0)
    expect(await db.notification.count()).toBe(0)
    expect((await service.submit(f.request, operationId, proof, 'source')).outcome).toBe('verified')
  })

  it('refuses revoked source and prepared protocol before consuming a backup code', async () => {
    const db = fixture.clients[0]!
    const f = await prepared(fixture)
    const service = verificationFixture(fixture).service
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'prepared' } })
    expect(
      await service.submit(
        f.request,
        randomUUID(),
        { method: 'recovery_code', code: f.codes[0] },
        'source'
      )
    ).toEqual({ outcome: 'unavailable' })
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'active' } })
    await db.$transaction(async (tx) => {
      const now = await lockMfaAccounts(tx, [f.user.id])
      await tx.authSessionFamily.update({ where: { id: f.family.id }, data: { revokedAt: now } })
    })
    expect(
      await service.submit(
        f.request,
        randomUUID(),
        { method: 'recovery_code', code: f.codes[0] },
        'source'
      )
    ).toEqual({ outcome: 'restart_required' })
    expect(await db.mfaRecoveryCode.count({ where: { consumedAt: null } })).toBe(10)
  })
})
