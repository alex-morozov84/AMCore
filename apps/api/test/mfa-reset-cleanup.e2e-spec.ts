import { randomUUID } from 'node:crypto'

import type { PinoLogger } from 'nestjs-pino'

import { advanceAccountSecurity } from '../src/core/auth/mfa/mfa-invalidation.js'
import { mfaCredential, mfaHash } from '../src/core/auth/mfa/mfa-secrets.js'
import { lockMfaAccounts } from '../src/core/auth/mfa/mfa-transaction.js'
import { SessionService } from '../src/core/auth/session.service.js'
import type { TokenService } from '../src/core/auth/token.service.js'
import type { GeoIpService } from '../src/infrastructure/geoip/geoip.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { authorityReader, createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Post-reset physical cleanup does not target a newly authorized independent family', () => {
  const fixture = new MfaProofFixture()
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)

  it('deletes only revoked rows after a new-epoch sign-in has already committed', async () => {
    const db = fixture.clients[0]!
    await db.mfaProtocol.create({ data: { id: 'platform', state: 'active' } })
    const f = await createAuthorityAccount(fixture)
    await db.$transaction(async (tx) => {
      await lockMfaAccounts(tx, [f.user.id])
      expect(await advanceAccountSecurity(tx, f.user.id)).toBe(4)
    })
    // Controlled interleaving: committed, independently authenticated new-epoch G exists before cleanup.
    const g = await db.authSessionFamily.create({
      data: {
        ...f.family,
        id: randomUUID(),
        securityVersion: 4,
        browserContextId: null,
        publicationGeneration: null,
      },
    })
    const session = await db.session.create({
      data: {
        userId: f.user.id,
        familyId: g.id,
        refreshToken: mfaHash(mfaCredential()),
        expiresAt: g.expiresAt,
      },
    })
    const claims = {
      ...f.claims,
      fid: g.id,
      sid: session.id,
      securityVersion: 4,
      browserBound: undefined,
    }
    expect((await authorityReader(db).read(claims)).kind).toBe('admitted')
    const service = new SessionService(
      db as unknown as PrismaService,
      {} as TokenService,
      {} as GeoIpService,
      { setContext: () => undefined, info: () => undefined } as unknown as PinoLogger
    )
    await service.deleteRevokedByUserId(f.user.id)
    expect(await db.session.findUnique({ where: { id: f.session.id } })).toBeNull()
    expect(await db.session.findUnique({ where: { id: session.id } })).toEqual(session)
    expect((await authorityReader(db).read(claims)).kind).toBe('admitted')
    expect((await authorityReader(db).read(f.claims, f.requestBinding)).kind).toBe('denied')
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 4,
    })
  })
})
