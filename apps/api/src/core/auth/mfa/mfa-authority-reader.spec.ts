import { jest } from '@jest/globals'

import { type JwtPayload, SystemRole } from '@amcore/shared'

import type { PrismaService } from '../../../prisma/index.js'

import { MfaAuthorityReader } from './mfa-authority-reader.service.js'

function fixture() {
  const now = new Date('2026-10-26T12:00:00Z')
  const account = {
    id: 'account',
    systemRole: SystemRole.SuperAdmin as SystemRole,
    mfaAccount: {
      securityVersion: 3,
      required: true,
      setupComplete: true,
      emergencyRequired: false,
    },
    mfaFactor: { version: 2 } as { version: number } | null,
  }
  const family = {
    id: 'family',
    userId: account.id,
    securityVersion: 3,
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null as Date | null,
    publicationState: 'published',
    primaryMethod: 'password',
    primaryAt: now,
    primaryProofId: 'password-event',
    mfaMethod: 'totp',
    mfaAt: now,
    mfaProofId: 'second-factor-event',
    factorVersion: 2,
    browserContextId: 'browser',
    publicationGeneration: 4,
    browserContext: {
      bindingHash: 'binding-hash',
      audience: 'product',
      id: 'browser',
      generation: 4,
      currentFamilyId: 'family',
      state: 'published',
      expiresAt: new Date(now.getTime() + 60_000),
    },
  }
  const claims: JwtPayload = {
    sub: account.id,
    email: 'operator@example.test',
    systemRole: SystemRole.SuperAdmin,
    fid: family.id,
    securityVersion: 3,
    browserBound: true,
  }
  const userRead = jest.fn(async (): Promise<typeof account | null> => account)
  const familyRead = jest.fn(async (): Promise<typeof family | null> => family)
  const protocol = { state: 'active', version: 1 }
  const protocolRead = jest.fn(async (): Promise<typeof protocol | null> => protocol)
  const clock = jest.fn(async () => [{ now }])
  const prisma = {
    user: { findUnique: userRead },
    authSessionFamily: { findUnique: familyRead },
    mfaProtocol: { findUnique: protocolRead },
    $queryRaw: clock,
  } as unknown as PrismaService
  return {
    requestBinding: {
      contextId: 'browser',
      generation: 4,
      audience: 'product' as const,
      bindingHash: 'binding-hash',
    },
    account,
    family,
    claims,
    userRead,
    familyRead,
    protocol,
    protocolRead,
    clock,
    reader: new MfaAuthorityReader(prisma),
  }
}

describe('Primary MFA authority reads without a stale cache fallback', () => {
  it('refuses missing accounts, missing family rows and an absent active protocol', async () => {
    const f = fixture()
    f.userRead.mockResolvedValueOnce(null)
    expect(await f.reader.read(f.claims, f.requestBinding)).toEqual({
      kind: 'denied',
      reason: 'account_missing',
    })
    f.protocolRead.mockResolvedValueOnce(null)
    expect(await f.reader.read(f.claims, f.requestBinding)).toEqual({
      kind: 'denied',
      reason: 'enforcement_unavailable',
    })
    f.familyRead.mockResolvedValueOnce(null)
    expect((await f.reader.read(f.claims, f.requestBinding)).kind).toBe('denied')
  })

  it('rechecks the account epoch on the next request after reset', async () => {
    const f = fixture()
    expect(await f.reader.read(f.claims, f.requestBinding)).toEqual({
      kind: 'admitted',
      operator: true,
    })
    f.account.mfaAccount.securityVersion++
    expect(await f.reader.read(f.claims, f.requestBinding)).toEqual({
      kind: 'denied',
      reason: 'session_changed',
    })
    expect(f.userRead).toHaveBeenCalledTimes(2)
  })

  it('refuses a revoked family and a superseded publication on subsequent requests', async () => {
    const f = fixture()
    f.family.revokedAt = new Date()
    expect((await f.reader.read(f.claims, f.requestBinding)).kind).toBe('denied')
    f.family.revokedAt = null
    f.family.browserContext.generation++
    expect(await f.reader.read(f.claims, f.requestBinding)).toEqual({
      kind: 'denied',
      reason: 'browser_context_changed',
    })
  })

  it.each(['prepared', 'unsupported'])(
    'refuses protected admission under protocol %s',
    async (state) => {
      const f = fixture()
      f.protocol.state = state
      expect(await f.reader.read(f.claims, f.requestBinding)).toEqual({
        kind: 'denied',
        reason: 'enforcement_unavailable',
      })
      expect(f.familyRead).not.toHaveBeenCalled()
    }
  )

  it('refuses a different active protocol version', async () => {
    const f = fixture()
    f.protocol.version = 2
    expect(await f.reader.read(f.claims, f.requestBinding)).toEqual({
      kind: 'denied',
      reason: 'enforcement_unavailable',
    })
  })

  it('keeps the ordinary independent-client exception separate from browser authority', async () => {
    const f = fixture()
    f.account.systemRole = SystemRole.User
    f.account.mfaAccount.required = false
    f.account.mfaFactor = null
    const direct: JwtPayload = {
      sub: f.claims.sub,
      email: f.claims.email,
      systemRole: SystemRole.User,
    }
    expect(await f.reader.read(direct)).toEqual({ kind: 'admitted', operator: false })
    expect(f.protocolRead).not.toHaveBeenCalled()
    expect(f.familyRead).not.toHaveBeenCalled()
    expect(f.userRead).toHaveBeenCalledTimes(1)
  })

  it('propagates DB and clock failures rather than admitting from previous state', async () => {
    const f = fixture()
    f.userRead.mockRejectedValueOnce(new Error('primary unavailable'))
    await expect(f.reader.read(f.claims, f.requestBinding)).rejects.toThrow('primary unavailable')
    f.clock.mockResolvedValueOnce([])
    await expect(f.reader.read(f.claims, f.requestBinding)).rejects.toThrow(
      'MFA admission clock unavailable'
    )
  })
})
