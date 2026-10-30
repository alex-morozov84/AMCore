import { randomUUID } from 'node:crypto'

import type { PinoLogger } from 'nestjs-pino'

import {
  continuationHash,
  directFlowBinding,
  type FlowRequest,
  lockMfaFlow,
} from '../src/core/auth/mfa/mfa-flow-lock.js'
import { mfaCredential, mfaHash } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { SessionService } from '../src/core/auth/session.service.js'
import type { TokenService } from '../src/core/auth/token.service.js'
import type { GeoIpService } from '../src/infrastructure/geoip/geoip.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { authorityReader, createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Refresh reuse denial commits exact family revocation before returning its error', () => {
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

  it.each(['validation', 'locked_rotation'] as const)(
    'commits reuse detected during %s without an epoch change or unrelated G revocation',
    async (path) => {
      const db = fixture.clients[0]!
      const f = await createAuthorityAccount(fixture)
      const now = await mfaDatabaseClock(db)
      await db.session.update({
        where: { id: f.session.id },
        data: { revokedAt: now, revocationReason: 'rotated' },
      })
      const child = await db.session.create({
        data: {
          userId: f.user.id,
          familyId: f.family.id,
          refreshToken: mfaHash(mfaCredential()),
          expiresAt: f.session.expiresAt,
        },
      })
      const g = await db.authSessionFamily.create({
        data: {
          ...f.family,
          id: randomUUID(),
          browserContextId: null,
          publicationGeneration: null,
        },
      })
      const other = await db.session.create({
        data: {
          userId: f.user.id,
          familyId: g.id,
          refreshToken: mfaHash(mfaCredential()),
          expiresAt: g.expiresAt,
        },
      })
      const credential = mfaCredential()
      await db.mfaFlow.update({
        where: { id: f.flow.id },
        data: {
          credentialHash: continuationHash(credential)!,
          browserContextId: f.requestBinding.contextId,
          publicationGeneration: 1,
        },
      })
      const source: FlowRequest = {
        credential,
        purpose: 'reauthenticate',
        audience: 'product',
        bindingHash: f.requestBinding.bindingHash,
        browser: f.requestBinding,
      }
      const independent = mfaCredential()
      const bindingHash = directFlowBinding(independent)!
      await db.mfaFlow.create({
        data: {
          userId: f.user.id,
          credentialHash: continuationHash(independent)!,
          purpose: 'login',
          authorityKind: 'identity',
          audience: 'direct',
          bindingHash,
          securityVersion: 3,
          expiresAt: new Date(now.getTime() + 300_000),
        },
      })
      const direct: FlowRequest = {
        credential: independent,
        purpose: 'login',
        audience: 'direct',
        bindingHash,
        browser: null,
      }
      const service = new SessionService(
        db as unknown as PrismaService,
        {
          generateRefreshToken: () => mfaCredential(),
          hashRefreshToken: mfaHash,
          getRefreshTokenExpiration: () => f.session.expiresAt,
        } as TokenService,
        {} as GeoIpService,
        {
          setContext: () => undefined,
          warn: () => undefined,
          info: () => undefined,
        } as unknown as PinoLogger
      )
      const attempt =
        path === 'validation'
          ? service.validateRefreshToken(f.session.refreshToken)
          : service.rotateRefreshToken(f.session.refreshToken, { userId: f.user.id })
      await expect(attempt).rejects.toMatchObject({ errorCode: 'TOKEN_INVALID' })
      expect(await db.session.findUnique({ where: { id: child.id } })).toMatchObject({
        revokedAt: expect.any(Date),
        revocationReason: 'reuse-detected',
      })
      expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
        revokedAt: expect.any(Date),
        publicationState: 'retired',
      })
      expect(await db.$transaction((tx) => lockMfaFlow(tx, source))).toBeNull()
      expect(await db.$transaction((tx) => lockMfaFlow(tx, direct))).not.toBeNull()
      expect(await db.session.findUnique({ where: { id: other.id } })).toEqual(other)
      expect(await db.authSessionFamily.findUnique({ where: { id: g.id } })).toEqual(g)
      expect(
        (
          await authorityReader(db).read({
            ...f.claims,
            fid: g.id,
            sid: other.id,
            browserBound: undefined,
          })
        ).kind
      ).toBe('admitted')
      expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
        securityVersion: 3,
      })
    }
  )
})
