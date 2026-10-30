import { jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { PinoLogger } from 'nestjs-pino'

import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { SessionService } from '../src/core/auth/session.service.js'
import { TokenService } from '../src/core/auth/token.service.js'
import { EnvService } from '../src/env/env.service.js'
import type { GeoIpService } from '../src/infrastructure/geoip/geoip.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { authorityReader, createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Refresh preserves current family authority without renewing authentication proofs', () => {
  const fixture = new MfaProofFixture()
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  afterEach(() => jest.restoreAllMocks())
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

  function service(expiresAt: Date): SessionService {
    const tokens = new TokenService(
      new JwtService({
        secret: '<fake-refresh-authority-jwt-key-at-least-32>',
        signOptions: { expiresIn: 900 },
      }),
      new EnvService(new ConfigService({ JWT_REFRESH_DAYS: 7 }))
    )
    tokens.getRefreshTokenExpiration = () => expiresAt
    return new SessionService(
      fixture.clients[0]! as unknown as PrismaService,
      tokens,
      {} as GeoIpService,
      { setContext: () => undefined, info: () => undefined } as unknown as PinoLogger
    )
  }

  it('rotates the SID and retains old proof identities and times with the exact browser binding', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const now = await mfaDatabaseClock(db)
    const proofAt = new Date(now.getTime() - 20 * 60_000)
    const before = await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { primaryAt: proofAt, mfaAt: proofAt },
    })
    const expiresAt = new Date(now.getTime() + 7 * 86400_000)
    const result = await service(expiresAt).rotateRefreshToken(
      f.session.refreshToken,
      { userId: f.user.id },
      f.requestBinding
    )
    expect(result.sessionId).not.toBe(f.session.id)
    expect(result.accessClaims).toMatchObject({
      ...f.claims,
      sid: result.sessionId,
    })
    const after = await db.authSessionFamily.findUniqueOrThrow({ where: { id: before.id } })
    expect(after).toMatchObject({
      ...before,
      expiresAt,
      lastAccessIssuedAt: expect.any(Date),
      retainUntil: expiresAt,
    })
    expect(result.accessToken).toEqual(expect.any(String))
    expect(await db.session.findUnique({ where: { id: result.sessionId } })).toMatchObject({
      familyId: before.id,
      lastAuthAt: f.session.lastAuthAt,
      expiresAt,
      revokedAt: null,
    })
    expect(
      await db.browserAuthContext.findUnique({ where: { id: f.requestBinding.contextId } })
    ).toMatchObject({ expiresAt, generation: 1, currentFamilyId: before.id })
    expect((await authorityReader(db).read(result.accessClaims, f.requestBinding)).kind).toBe(
      'admitted'
    )
  })

  it('rolls back refresh rotation and retention if access signing fails', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const before = await db.browserAuthContext.findUniqueOrThrow({
      where: { id: f.requestBinding.contextId },
    })
    jest.spyOn(TokenService.prototype, 'generateAccessToken').mockImplementationOnce(() => {
      throw new Error('signer offline')
    })
    await expect(
      service(new Date(f.session.expiresAt.getTime() + 60_000)).rotateRefreshToken(
        f.session.refreshToken,
        { userId: f.user.id },
        f.requestBinding
      )
    ).rejects.toThrow('signer offline')
    expect(await db.session.findMany({ where: { userId: f.user.id } })).toEqual([f.session])
    expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
      f.family
    )
    expect(
      await db.browserAuthContext.findUniqueOrThrow({ where: { id: f.requestBinding.contextId } })
    ).toEqual(before)
  })

  it.each(['missing_binding', 'stale_generation', 'revoked_family'] as const)(
    'refuses %s without creating or retiring a session',
    async (reason) => {
      const db = fixture.clients[0]!
      const f = await createAuthorityAccount(fixture)
      if (reason === 'stale_generation')
        await db.browserAuthContext.update({
          where: { id: f.requestBinding.contextId },
          data: { generation: 2 },
        })
      if (reason === 'revoked_family')
        await db.authSessionFamily.update({
          where: { id: f.family.id },
          data: { revokedAt: await mfaDatabaseClock(db) },
        })
      await expect(
        service(f.session.expiresAt).rotateRefreshToken(
          f.session.refreshToken,
          { userId: f.user.id },
          reason === 'missing_binding' ? null : f.requestBinding
        )
      ).rejects.toMatchObject({ errorCode: 'SESSION_CHANGED' })
      expect(await db.session.findMany({ where: { userId: f.user.id } })).toEqual([f.session])
    }
  )
})
