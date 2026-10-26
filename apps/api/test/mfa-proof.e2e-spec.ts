import { generate } from 'otplib'

import { backupCodeHash } from '../src/core/auth/mfa/mfa-secrets.js'

import { MfaProofFixture } from './mfa-proof.fixture.js'

// Public RFC6238 test vector, never a deployment credential.
const publicSeed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('MFA proof atomicity on PostgreSQL across independent clients', () => {
  const fixture = new MfaProofFixture()
  let userId: string
  let codes: string[]
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    const db = fixture.clients[0]!
    await db.user.deleteMany()
    const user = await db.user.create({
      data: { email: 'mfa.fixture@example.test', emailCanonical: 'mfa.fixture@example.test' },
    })
    userId = user.id
    await db.mfaAccount.create({
      data: { userId, securityVersion: 1, required: true, setupComplete: true },
    })
    await db.mfaFactor.create({
      data: { id: 'factor', userId, ...fixture.codec.encrypt(userId, 'factor', publicSeed) },
    })
    const generated = await db.$transaction((tx) =>
      fixture.first.replaceBackupCodes(tx, userId, 1, 0)
    )
    codes = generated!.codes
  })

  it('commits exactly one proof when two processes consume the same backup code', async () => {
    const proof = { method: 'recovery_code' as const, code: codes[0]! }
    const results = await Promise.all([
      fixture.clients[0]!.$transaction((tx) => fixture.first.consume(tx, userId, 1, proof)),
      fixture.clients[1]!.$transaction((tx) => fixture.second.consume(tx, userId, 1, proof)),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await fixture.clients[0]!.mfaRecoveryCode.count({ where: { consumedAt: null } })).toBe(9)
    expect(await fixture.clients[0]!.mfaFactor.count()).toBe(1)
  })

  it('rolls consumption back with a failed enclosing security change', async () => {
    const db = fixture.clients[0]!
    const proof = { method: 'recovery_code' as const, code: codes[0]! }
    await expect(
      db.$transaction(async (tx) => {
        const consumed = await fixture.first.consume(tx, userId, 1, proof)
        if (!consumed) throw new Error('fixture did not consume code')
        throw new Error('security effect failed')
      })
    ).rejects.toThrow('security effect failed')
    expect(await db.mfaRecoveryCode.count({ where: { consumedAt: null } })).toBe(10)
    expect(
      await db.$transaction((tx) => fixture.first.consume(tx, userId, 1, proof))
    ).toMatchObject({ method: 'recovery_code', recoveryGeneration: 1 })
  })

  it('can consume the last code and replace the set in the same committed transaction', async () => {
    const db = fixture.clients[0]!
    await db.mfaRecoveryCode.updateMany({
      where: { hash: { not: backupCodeHash(userId, 1, codes[9]!) } },
      data: { consumedAt: new Date() },
    })
    const next = await db.$transaction(async (tx) => {
      const proof = await fixture.first.consume(tx, userId, 1, {
        method: 'recovery_code',
        code: codes[9]!,
      })
      if (!proof) throw new Error('last backup code refused')
      return fixture.first.replaceBackupCodes(tx, userId, 1, 1)
    })
    expect(next?.generation).toBe(2)
    expect(next?.codes).toHaveLength(10)
    expect(await db.mfaRecoveryCode.count({ where: { consumedAt: null } })).toBe(10)
    expect(
      await db.$transaction((tx) =>
        fixture.first.consume(tx, userId, 1, {
          method: 'recovery_code',
          code: codes[9]!,
        })
      )
    ).toBeNull()
  })

  it('refuses wrong epoch and unacknowledged setup without consuming a code', async () => {
    const db = fixture.clients[0]!
    const proof = { method: 'recovery_code' as const, code: codes[0]! }
    expect(await db.$transaction((tx) => fixture.first.consume(tx, userId, 0, proof))).toBeNull()
    await db.mfaAccount.update({ where: { userId }, data: { setupComplete: false } })
    expect(await db.$transaction((tx) => fixture.first.consume(tx, userId, 1, proof))).toBeNull()
    expect(await db.mfaRecoveryCode.count({ where: { consumedAt: null } })).toBe(10)
  })

  it('serializes set replacement and retires old hashes without storing plaintext', async () => {
    const outcomes = await Promise.all([
      fixture.clients[0]!.$transaction((tx) => fixture.first.replaceBackupCodes(tx, userId, 1, 1)),
      fixture.clients[1]!.$transaction((tx) => fixture.second.replaceBackupCodes(tx, userId, 1, 1)),
    ])
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    const db = fixture.clients[0]!
    expect(
      await db.mfaRecoveryCode.findUnique({
        where: { hash: backupCodeHash(userId, 1, codes[0]!) },
      })
    ).toBeNull()
    const records = await db.mfaRecoveryCode.findMany()
    expect(records).toHaveLength(10)
    expect(records.every((row) => row.generation === 2 && /^[a-f0-9]{64}$/.test(row.hash))).toBe(
      true
    )
    expect(records.some((row) => codes.includes(row.hash))).toBe(false)
  })

  it('commits one TOTP step globally across two clients, then refuses replay', async () => {
    const db = fixture.clients[0]!
    const [clock] = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const code = await generate({
      secret: publicSeed,
      epoch: Math.floor(clock!.now.getTime() / 1000),
    })
    const proof = { method: 'totp' as const, code }
    const outcomes = await Promise.all([
      db.$transaction((tx) => fixture.first.consume(tx, userId, 1, proof)),
      fixture.clients[1]!.$transaction((tx) => fixture.second.consume(tx, userId, 1, proof)),
    ])
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    expect(await db.$transaction((tx) => fixture.first.consume(tx, userId, 1, proof))).toBeNull()
  })
})
