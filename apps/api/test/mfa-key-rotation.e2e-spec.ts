import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { generate } from 'otplib'

import { MfaEncryptionService } from '../src/core/auth/mfa/mfa-encryption.service.js'
import { MfaKeyRotation } from '../src/core/auth/mfa/mfa-key-rotation.js'
import { MfaProofRepository } from '../src/core/auth/mfa/mfa-proof.repository.js'
import { createTotpSecret } from '../src/core/auth/mfa/mfa-totp.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { EnvService } from '../src/env/env.service.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

function codec(retained = true): MfaEncryptionService {
  return new MfaEncryptionService(
    new EnvService(
      new ConfigService({
        MFA_ACTIVE_KEY_ID: 'next',
        MFA_ENCRYPTION_KEYS: JSON.stringify({
          next: Buffer.alloc(32, 4).toString('base64'),
          ...(retained && { fixture: Buffer.alloc(32, 3).toString('base64') }),
        }),
      })
    )
  )
}

describe('Account-locked at-rest key migration preserves factor identity and assurance', () => {
  const fixture = new MfaProofFixture()
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    const db = fixture.clients[0]!
    await db.user.deleteMany()
    await db.browserAuthContext.deleteMany()
  })

  it('preserves a consumed TOTP step, backup set, family proofs and account version', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const original = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    const seed = fixture.codec.decrypt(
      f.user.id,
      original.id,
      original.keyId,
      original.encryptedSeed
    )
    await db.$transaction((tx) => fixture.first.replaceBackupCodes(tx, f.user.id, 3, 0))
    const account = await db.mfaAccount.findUniqueOrThrow({ where: { userId: f.user.id } })
    const codes = await db.mfaRecoveryCode.findMany({
      where: { userId: f.user.id },
      orderBy: { id: 'asc' },
    })
    const now = await mfaDatabaseClock(db)
    const code = await generate({ secret: seed, epoch: Math.floor(now.getTime() / 1000) })
    await expect(
      db.$transaction((tx) => fixture.first.consume(tx, f.user.id, 3, { method: 'totp', code }))
    ).resolves.toMatchObject({ method: 'totp' })
    const before = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    const next = codec()
    const result = await new MfaKeyRotation(db, next).batch()
    expect(result).toEqual({
      examined: 1,
      rotated: 1,
      skipped: 0,
      failed: 0,
      nextUserId: null,
      remaining: false,
    })
    const after = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    expect(after).toMatchObject({
      ...before,
      keyId: 'next',
      encryptedSeed: expect.any(String),
      updatedAt: expect.any(Date),
    })
    expect(after.encryptedSeed).not.toBe(before.encryptedSeed)
    expect(next.decrypt(f.user.id, after.id, after.keyId, after.encryptedSeed)).toBe(seed)
    expect(await db.mfaAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).toEqual(account)
    expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
      f.family
    )
    expect(
      await db.mfaRecoveryCode.findMany({ where: { userId: f.user.id }, orderBy: { id: 'asc' } })
    ).toEqual(codes)
    const proofs = new MfaProofRepository(next)
    await expect(
      db.$transaction((tx) => proofs.consume(tx, f.user.id, 3, { method: 'totp', code }))
    ).resolves.toBeNull()
    await expect(new MfaKeyRotation(db, next).batch()).resolves.toMatchObject({
      examined: 0,
      rotated: 0,
      remaining: false,
    })
  })

  it.each(['missing_key', 'tampered_seed'])(
    'reports %s without resetting or rewriting the failed account',
    async (failure) => {
      const db = fixture.clients[0]!
      const f = await createAuthorityAccount(fixture)
      if (failure === 'tampered_seed')
        await db.mfaFactor.update({
          where: { userId: f.user.id },
          data: { encryptedSeed: '<fake-corrupt-ciphertext>' },
        })
      const before = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
      const result = await new MfaKeyRotation(db, codec(failure !== 'missing_key')).batch()
      expect(result).toEqual({
        examined: 1,
        rotated: 0,
        skipped: 0,
        failed: 1,
        nextUserId: null,
        remaining: true,
      })
      expect(await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })).toEqual(before)
      expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
        f.family
      )
      expect(JSON.stringify(result)).not.toContain(before.encryptedSeed)
    }
  )

  it('migrates at most100 records and continues explicitly without changing replay counters', async () => {
    const db = fixture.clients[0]!
    const users = Array.from({ length: 101 }, (_, index) => ({
      id: `rotation-user-${String(index).padStart(3, '0')}`,
      email: `rotation-${index}@example.test`,
      emailCanonical: `rotation-${index}@example.test`,
    }))
    await db.user.createMany({ data: users })
    await db.mfaFactor.createMany({
      data: users.map((user) => {
        const id = randomUUID()
        return {
          id,
          userId: user.id,
          version: 7,
          lastAcceptedStep: 42n,
          ...fixture.codec.encrypt(user.id, id, createTotpSecret(user.email).secret),
        }
      }),
    })
    const rotation = new MfaKeyRotation(db, codec())
    const first = await rotation.batch()
    expect(first).toEqual({
      examined: 100,
      rotated: 100,
      skipped: 0,
      failed: 0,
      nextUserId: users[99]!.id,
      remaining: true,
    })
    await expect(rotation.batch(first.nextUserId!)).resolves.toEqual({
      examined: 1,
      rotated: 1,
      skipped: 0,
      failed: 0,
      nextUserId: null,
      remaining: false,
    })
    expect(
      await db.mfaFactor.count({ where: { keyId: 'next', version: 7, lastAcceptedStep: 42n } })
    ).toBe(101)
  })
})
