import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'

import { lockMfaFlow } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { backupCodeHash, mfaHash } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'

import { backupRotationFixture } from './mfa-backup-rotation.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Fresh backup-proof rotation stays on F without revoking unrelated sessions', () => {
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

  it('uses the last code to create one new set and keeps F/G and account setup active', async () => {
    const db = fixture.clients[0]!
    const f = await backupRotationFixture(fixture)
    await db.mfaRecoveryCode.updateMany({
      where: { userId: f.user.id },
      data: { consumedAt: await mfaDatabaseClock(db) },
    })
    // Leave exactly one unused code for the real verifier to consume.
    const rows = await db.mfaRecoveryCode.findMany({
      where: { userId: f.user.id },
      orderBy: { id: 'asc' },
    })
    const last = rows[rows.length - 1]!
    await db.mfaRecoveryCode.update({ where: { id: last.id }, data: { consumedAt: null } })
    const code = f.codes.find((value) => backupCodeHash(f.user.id, 1, value) === last.hash)!
    expect(
      await f.effects.service.submit(
        f.request,
        randomUUID(),
        { method: 'recovery_code', code },
        'source'
      )
    ).toEqual({ outcome: 'verified', requiredProofs: [] })
    expect(await db.mfaRecoveryCode.count({ where: { consumedAt: null } })).toBe(0)
    const g = await db.authSessionFamily.create({
      data: { ...f.family, id: randomUUID(), browserContextId: null, publicationGeneration: null },
    })
    await db.session.create({
      data: {
        userId: f.user.id,
        familyId: g.id,
        refreshToken: mfaHash(randomUUID()),
        expiresAt: g.expiresAt,
      },
    })
    const sessions = await db.session.findMany()
    const operationId = randomUUID()
    const result = await f.rotation.rotate(f.request, operationId, 'source')
    if (result.outcome !== 'codes') throw new Error('Expected new codes')
    expect(result.generation).toBe(2)
    expect(result.codes).toHaveLength(10)
    expect(await f.rotation.rotate(f.request, operationId, 'source')).toEqual({
      outcome: 'already_generated',
      generation: 2,
    })
    expect(await db.authSessionFamily.findUnique({ where: { id: g.id } })).toEqual(g)
    expect(await db.session.findMany()).toEqual(sessions)
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      mfaMethod: 'recovery_code',
      recoveryGeneration: 1,
      revokedAt: null,
    })
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 3,
      setupComplete: true,
      codeGeneration: 2,
    })
    expect(await f.ack.acknowledge(f.request, randomUUID(), 2, 'source')).toEqual({
      outcome: 'acknowledged',
      generation: 2,
    })
    expect(await db.mfaRecoveryCode.count({ where: { userId: f.user.id, consumedAt: null } })).toBe(
      10
    )
    const durable = JSON.stringify([
      await db.mfaFlow.findMany(),
      await db.mfaOperation.findMany(),
      await db.notification.findMany(),
    ])
    for (const value of result.codes) expect(durable).not.toContain(value)
  })

  it('does not replace codes when fresh second-factor evidence is missing', async () => {
    const db = fixture.clients[0]!
    const f = await backupRotationFixture(fixture)
    const codes = await db.mfaRecoveryCode.findMany()
    expect(await f.rotation.rotate(f.request, randomUUID(), 'source')).toEqual({
      outcome: 'proof_required',
      requiredProofs: ['second_factor'],
    })
    expect(await db.mfaRecoveryCode.findMany()).toEqual(codes)
  })

  it('rolls back rotation and F update when notification intent fails, keeping prior local proof reusable', async () => {
    const db = fixture.clients[0]!
    const f = await backupRotationFixture(fixture)
    await f.effects.service.submit(
      f.request,
      randomUUID(),
      { method: 'recovery_code', code: f.codes[0] },
      'source'
    )
    const before = await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    const codes = await db.mfaRecoveryCode.findMany()
    const spy = jest
      .spyOn(f.effects.notifications, 'notifyTx')
      .mockRejectedValueOnce(new Error('intent unavailable'))
    await expect(f.rotation.rotate(f.request, randomUUID(), 'source')).rejects.toThrow(
      'intent unavailable'
    )
    spy.mockRestore()
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(before)
    expect(await db.mfaRecoveryCode.findMany()).toEqual(codes)
    expect((await f.rotation.rotate(f.request, randomUUID(), 'source')).outcome).toBe('codes')
  })

  it('rejects the old local proof generation and a revoked source without consuming more codes', async () => {
    const db = fixture.clients[0]!
    const f = await backupRotationFixture(fixture)
    await f.effects.service.submit(
      f.request,
      randomUUID(),
      { method: 'recovery_code', code: f.codes[0] },
      'source'
    )
    await db.$transaction((tx) => fixture.first.replaceBackupCodes(tx, f.user.id, 3, 1))
    expect(await f.rotation.rotate(f.request, randomUUID(), 'source')).toEqual({
      outcome: 'proof_required',
      requiredProofs: ['second_factor'],
    })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: await mfaDatabaseClock(db) },
    })
    expect(await db.$transaction((tx) => lockMfaFlow(tx, f.request))).toBeNull()
    expect(await f.rotation.rotate(f.request, randomUUID(), 'source')).toEqual({
      outcome: 'restart_required',
    })
    expect(await db.mfaRecoveryCode.count({ where: { userId: f.user.id, consumedAt: null } })).toBe(
      10
    )
  })
})
