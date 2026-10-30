import { jest } from '@jest/globals'
import { JwtService } from '@nestjs/jwt'

import { issueFamilyAccessToken } from '../src/core/auth/mfa/mfa-access-issuance.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { sessionCoordinationLockKey } from '../src/core/auth/session-lock-key.js'
import { TokenService } from '../src/core/auth/token.service.js'
import type { EnvService } from '../src/env/env.service.js'
import { acquireXactLock } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Family tombstones outlive every issued access credential and refresh deadline', () => {
  const fixture = new MfaProofFixture()
  const jwt = new JwtService({
    secret: '<fake-family-retention-jwt-key-at-least-32>',
    signOptions: { expiresIn: 7200 },
  })
  const tokens = new TokenService(jwt, {} as EnvService)
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    const db = fixture.clients[0]!
    await db.user.deleteMany()
    await db.browserAuthContext.deleteMany()
  })
  afterEach(() => jest.restoreAllMocks())

  it('retains until the later actual access deadline without extending family authority or proofs', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const before = await mfaDatabaseClock(db)
    const token = await db.$transaction(async (tx) => {
      await acquireXactLock(tx, sessionCoordinationLockKey(f.user.id))
      return issueFamilyAccessToken(tx, tokens, f.claims)
    })
    const claims = jwt.verify(token)
    const after = await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    expect(after).toMatchObject({
      ...f.family,
      lastAccessIssuedAt: expect.any(Date),
      retainUntil: expect.any(Date),
    })
    expect(after.lastAccessIssuedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(after.retainUntil!.getTime()).toBeGreaterThanOrEqual(claims.exp * 1000)
    expect(after.retainUntil!.getTime()).toBeGreaterThanOrEqual(
      after.lastAccessIssuedAt!.getTime() + 7200_000 - 1
    )
    const saved = after.retainUntil
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: new Date() },
    })
    await expect(
      db.$transaction((tx) => issueFamilyAccessToken(tx, tokens, f.claims))
    ).rejects.toThrow('authority changed')
    expect(
      (await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).retainUntil
    ).toEqual(saved)
  })

  it('never shortens a previous boundary when the configured access lifetime decreases', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    await db.$transaction((tx) => issueFamilyAccessToken(tx, tokens, f.claims))
    const before = await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    const shorter = new TokenService(
      new JwtService({
        secret: '<fake-shorter-family-jwt-key-at-least-32>',
        signOptions: { expiresIn: 1 },
      }),
      {} as EnvService
    )
    await db.$transaction((tx) => issueFamilyAccessToken(tx, shorter, f.claims))
    const after = await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    expect(after.retainUntil).toEqual(before.retainUntil)
    expect(after.lastAccessIssuedAt!.getTime()).toBeGreaterThanOrEqual(
      before.lastAccessIssuedAt!.getTime()
    )
  })

  it('rolls back issuance metadata with its enclosing transaction and refuses unbounded JWTs', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    await expect(
      db.$transaction(async (tx) => {
        await issueFamilyAccessToken(tx, tokens, f.claims)
        throw new Error('strict audit rejected')
      })
    ).rejects.toThrow('strict audit rejected')
    expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
      f.family
    )
    const unbounded = new TokenService(
      new JwtService({
        secret: '<fake-unbounded-family-jwt-key-at-least-32>',
      }),
      {} as EnvService
    )
    await expect(
      db.$transaction((tx) => issueFamilyAccessToken(tx, unbounded, f.claims))
    ).rejects.toThrow('bounded lifetime')
    expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
      f.family
    )
  })
})
