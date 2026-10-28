import { jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'

import { EnvService } from '../../../env/env.service.js'
import type { PrismaService } from '../../../prisma/index.js'

import { MfaEncryptionService } from './mfa-encryption.service.js'
import { MfaFoundationService } from './mfa-foundation.service.js'
import { liveFamily, requiredMfaProofs } from './mfa-policy.js'
import { backupCodeHash, generateBackupCodes } from './mfa-secrets.js'
import { createTotpSecret, verifyTotp } from './mfa-totp.js'

function encryption(
  keyId = 'current',
  keys: unknown = { current: Buffer.alloc(32, 1).toString('base64') }
) {
  return new MfaEncryptionService(
    new EnvService(
      new ConfigService({
        MFA_ACTIVE_KEY_ID: keyId,
        MFA_ENCRYPTION_KEYS: JSON.stringify(keys),
      })
    )
  )
}

describe('Dormant MFA security primitives', () => {
  it.each([null, [], {}, { current: 'invalid' }, { current: Buffer.alloc(31).toString('base64') }])(
    'fails closed for malformed or missing selected keys: %j',
    (keys) => {
      expect(() => encryption('current', keys).assertReady()).toThrow(
        'MFA encryption key unavailable'
      )
    }
  )

  it('exports an authenticator URI matching the verified TOTP parameters', () => {
    const result = createTotpSecret('operator@example.test')
    const uri = new URL(result.otpauthUri)
    expect(result.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(uri.protocol).toBe('otpauth:')
    expect(uri.hostname).toBe('totp')
    expect(uri.searchParams.get('secret')).toBe(result.secret)
    expect(uri.searchParams.get('issuer')).toBe('AMCore')
    // The installed URI adapter omits these standard otpauth defaults.
    expect(uri.searchParams.get('algorithm') ?? 'SHA1').toBe('SHA1')
    expect(uri.searchParams.get('digits') ?? '6').toBe('6')
    expect(uri.searchParams.get('period') ?? '30').toBe('30')
  })

  it('authenticates ciphertext, account, factor and key identity', () => {
    const codec = encryption()
    const packed = codec.encrypt('user-one', 'factor-one', 'public test plaintext')
    expect(codec.decrypt('user-one', 'factor-one', packed.keyId, packed.encryptedSeed)).toBe(
      'public test plaintext'
    )
    expect(() =>
      codec.decrypt('user-two', 'factor-one', packed.keyId, packed.encryptedSeed)
    ).toThrow()
    expect(() =>
      codec.decrypt('user-one', 'factor-two', packed.keyId, packed.encryptedSeed)
    ).toThrow()
    expect(() => codec.decrypt('user-one', 'factor-one', 'missing', packed.encryptedSeed)).toThrow()
    const tampered = Buffer.from(packed.encryptedSeed, 'base64')
    tampered[28] = tampered[28]! ^ 1
    expect(() =>
      codec.decrypt('user-one', 'factor-one', packed.keyId, tampered.toString('base64'))
    ).toThrow()
  })

  it('reads retained keys during rotation without using them for new encryption', () => {
    const oldKey = Buffer.alloc(32, 1).toString('base64')
    const old = encryption('old', { current: oldKey, old: oldKey })
    const payload = old.encrypt('user', 'factor', 'public test plaintext')
    const next = encryption('current', {
      current: Buffer.alloc(32, 2).toString('base64'),
      old: oldKey,
    })
    expect(next.decrypt('user', 'factor', payload.keyId, payload.encryptedSeed)).toBe(
      'public test plaintext'
    )
    expect(next.encrypt('user', 'factor', 'public test plaintext').keyId).toBe('current')
  })

  it('produces ten independent 128-bit codes and binds hashes to owner/generation', () => {
    const codes = generateBackupCodes()
    expect(codes.length).toBe(10)
    expect(new Set(codes).size).toBe(10)
    expect(codes.every((code) => /^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(code))).toBe(true)
    const hash = backupCodeHash('user-one', 1, codes[0]!)
    expect(hash).not.toBe(backupCodeHash('user-two', 1, codes[0]!))
    expect(hash).not.toBe(backupCodeHash('user-one', 2, codes[0]!))
    expect(hash).toBe(backupCodeHash('user-one', 1, codes[0]!.replaceAll('-', '').toLowerCase()))
  })

  it('checks the RFC6238 SHA1 vector as six digits and refuses its accepted step', async () => {
    // RFC6238's public test key (20 ASCII digits encoded as Base32), never an account seed.
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' // gitleaks:allow -- public RFC6238 test vector
    const now = new Date(59_000)
    const result = await verifyTotp(secret, '287082', -1n, now)
    expect(result.valid).toBe(true)
    expect(await verifyTotp(secret, '287082', 1n, now)).toMatchObject({ valid: false })
    expect(await verifyTotp(secret, '287082', 100n, now)).toMatchObject({ valid: false })
  })

  it('reuses fresh backup proof and independently requests only stale evidence', () => {
    const now = new Date('2026-01-01T12:00:00Z')
    const evidence = {
      primaryAt: now,
      primaryProofId: 'password-event',
      mfaAt: now,
      mfaProofId: 'second-factor-event',
      mfaMethod: 'recovery_code',
      factorVersion: 1,
    }
    expect(requiredMfaProofs(evidence, 1, now)).toEqual([])
    expect(
      requiredMfaProofs({ ...evidence, primaryProofId: null, mfaProofId: null }, 1, now)
    ).toEqual(['password', 'second_factor'])
    expect(
      requiredMfaProofs({ ...evidence, primaryAt: new Date(now.getTime() - 600_001) }, 1, now)
    ).toEqual(['password'])
    expect(requiredMfaProofs(evidence, 2, now)).toEqual(['second_factor'])
    expect(requiredMfaProofs({ ...evidence, mfaAt: new Date(now.getTime() + 1) }, 1, now)).toEqual([
      'second_factor',
    ])
  })

  it('refuses revoked, unpublished, foreign, stale-version and expired families', () => {
    const now = new Date()
    const family = {
      userId: 'user',
      securityVersion: 1,
      expiresAt: new Date(now.getTime() + 60_000),
      revokedAt: null,
      publicationState: 'published',
    }
    expect(liveFamily(family, 'user', 1, now)).toBe(true)
    expect(liveFamily({ ...family, revokedAt: now }, 'user', 1, now)).toBe(false)
    expect(liveFamily({ ...family, publicationState: 'pending' }, 'user', 1, now)).toBe(false)
    expect(liveFamily(family, 'foreign', 1, now)).toBe(false)
    expect(liveFamily(family, 'user', 2, now)).toBe(false)
    expect(liveFamily({ ...family, expiresAt: now }, 'user', 1, now)).toBe(false)
  })

  it.each([
    { protocol: null, factors: 0, accounts: 0, allowed: true },
    { protocol: { state: 'prepared', version: 1 }, factors: 0, accounts: 0, allowed: true },
    { protocol: { state: 'active', version: 1 }, factors: 0, accounts: 0, allowed: true },
    { protocol: null, factors: 1, accounts: 0, allowed: false },
    { protocol: null, factors: 0, accounts: 1, allowed: false },
    { protocol: { state: 'prepared', version: 2 }, factors: 0, accounts: 0, allowed: false },
  ])(
    'validates local prepared or compatible active startup: %j',
    async ({ protocol, factors, accounts, allowed }) => {
      const db = {
        mfaProtocol: { findUnique: jest.fn(async () => protocol) },
        mfaFactor: { count: jest.fn(async () => factors) },
        mfaAccount: { count: jest.fn(async () => accounts) },
      } as unknown as PrismaService
      const startup = new MfaFoundationService(db, encryption()).onModuleInit()
      const result = await startup.then(
        () => true,
        () => false
      )
      expect(result).toBe(allowed)
    }
  )
  it('refuses an active deployment without the configured current encryption key', async () => {
    const db = {
      mfaProtocol: { findUnique: async () => ({ state: 'active', version: 1 }) },
      mfaFactor: { count: async () => 1 },
      mfaAccount: { count: async () => 1 },
    } as unknown as PrismaService
    await expect(
      new MfaFoundationService(db, encryption('missing', {})).onModuleInit()
    ).rejects.toThrow('MFA encryption key unavailable')
  })
})
