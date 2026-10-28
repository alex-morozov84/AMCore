import { jest } from '@jest/globals'

import { type JwtPayload, SystemRole } from '@amcore/shared'

import type { PrismaService } from '../../../prisma/index.js'

import { MfaAuthorityReader } from './mfa-authority-reader.service.js'
import { mfaPrimaryProjectionSchema } from './mfa-primary-projection.schema.js'

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
  const primary = jest.fn(async (sql: { values: unknown[] }) => {
    const user = await userRead()
    if (!user) return []
    const [time] = await clock()
    if (!time) throw new Error('MFA admission clock unavailable')
    return [
      {
        user,
        family: sql.values[1] ? await familyRead() : null,
        protocol: await protocolRead(),
        now: time.now,
        session: null,
      },
    ]
  })
  const prisma = { $queryRaw: primary } as unknown as PrismaService
  return {
    primary,
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
      expect(f.primary).toHaveBeenCalledTimes(1)
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
    expect(f.primary).toHaveBeenCalledTimes(1)
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

it('interprets PostgreSQL JSON timestamp-without-time-zone values as UTC', async () => {
  const f = fixture()
  const [clock] = await f.clock()
  const raw = JSON.parse(
    JSON.stringify({
      now: clock!.now,
      user: f.account,
      family: f.family,
      protocol: f.protocol,
      session: null,
    }).replaceAll('Z"', '"')
  )
  const parsed = mfaPrimaryProjectionSchema.parse(raw)
  expect(parsed.now.getTime()).toBe(clock!.now.getTime())
  expect(parsed.family!.expiresAt.getTime()).toBe(f.family.expiresAt.getTime())
})

describe('Prepared deployment refuses every operator grant', () => {
  function prepared() {
    const f = fixture()
    f.protocol.state = 'prepared'
    f.account.mfaAccount.required = false
    f.account.mfaAccount.setupComplete = false
    f.account.mfaFactor = null
    const legacy = { sub: f.claims.sub, email: f.claims.email, systemRole: SystemRole.SuperAdmin }
    return { ...f, legacy }
  }

  it('refuses untouched legacy operator tokens as well as strict MFA admission', async () => {
    const f = prepared()
    expect(await f.reader.readForRuntime(f.legacy, null)).toEqual({
      kind: 'denied',
      reason: 'enforcement_unavailable',
    })
    expect(await f.reader.read(f.legacy)).toEqual({
      kind: 'denied',
      reason: 'enforcement_unavailable',
    })
    expect(await f.reader.readForRuntime(f.claims, f.requestBinding)).toEqual({
      kind: 'denied',
      reason: 'enforcement_unavailable',
    })
  })

  it.each(['required', 'setupComplete', 'emergencyRequired'] as const)(
    'does not relax existing %s state',
    async (flag) => {
      const f = prepared()
      f.account.mfaAccount[flag] = true
      expect(await f.reader.readForRuntime(f.legacy, null)).toEqual({
        kind: 'denied',
        reason: 'enforcement_unavailable',
      })
    }
  )

  it('refuses bound factors and incompatible protocols; demotion never preserves operator authority', async () => {
    const f = prepared()
    f.account.mfaFactor = { version: 1 }
    expect((await f.reader.readForRuntime(f.legacy, null)).kind).toBe('denied')
    f.account.mfaFactor = null
    f.protocol.version = 2
    expect((await f.reader.readForRuntime(f.legacy, null)).kind).toBe('denied')
    f.protocol.version = 1
    f.account.systemRole = SystemRole.User
    expect(await f.reader.readForRuntime(f.legacy, null)).toEqual({
      kind: 'denied',
      reason: 'enforcement_unavailable',
    })
    f.protocol.state = 'active'
    expect((await f.reader.readForRuntime(f.legacy, null)).kind).toBe('denied')
  })
})
