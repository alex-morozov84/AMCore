import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as argon2 from 'argon2'

import type { JwtPayload } from '@amcore/shared'

import { MfaFamilyIssuanceService } from '../src/core/auth/mfa/mfa-family-issuance.service.js'
import { settlePublication } from '../src/core/auth/mfa/mfa-publication-settlement.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { PendingSessionProof } from '../src/core/auth/mfa/pending-session-proof.js'
import { TokenService } from '../src/core/auth/token.service.js'
import { EnvService } from '../src/env/env.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { authorityReader } from './mfa-authority.fixture.js'
import { loginStartFixture } from './mfa-login-start.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'
import { verificationFixture } from './mfa-verification.fixture.js'

const password = '<fake-isolated-password-login>'

describe('Real password and backup proof through restricted browser publication', () => {
  const fixture = new MfaProofFixture()
  let hash: string
  beforeAll(async () => {
    hash = await argon2.hash(password)
    await fixture.start()
  }, 120000)
  afterAll(() => fixture.close(), 60000)

  it('admits the exact family only after backup consumption and receipt publication', async () => {
    const db = fixture.clients[0]!
    await db.mfaProtocol.create({ data: { id: 'platform', state: 'active' } })
    const f = await loginStartFixture(fixture, hash)
    await db.user.update({ where: { id: f.user.id }, data: { emailVerified: true } })
    const codes = await db.$transaction((tx) =>
      fixture.first.replaceBackupCodes(tx, f.user.id, 3, 0)
    )
    const start = await f.service.password(
      f.user.email,
      password,
      'source',
      {
        kind: 'browser',
        binding: f.requestBinding,
      },
      randomUUID()
    )
    if (start.kind !== 'mfa') throw new Error('Expected protected continuation')
    expect(
      await verificationFixture(fixture).service.submit(
        start.request,
        randomUUID(),
        {
          method: 'recovery_code',
          code: codes!.codes[0],
        },
        'source'
      )
    ).toEqual({ outcome: 'verified', requiredProofs: [] })
    const jwt = new JwtService({
      secret: '<fake-local-password-login-signing-key-at-least-32>',
      signOptions: { expiresIn: '15m' },
    })
    const tokens = new TokenService(
      jwt,
      new EnvService(new ConfigService({ JWT_REFRESH_DAYS: 30 }))
    )
    const issuer = new MfaFamilyIssuanceService(db as unknown as PrismaService, tokens)
    const operationId = randomUUID()
    const vaultBinding = mfaCredential()
    const issued = await issuer.complete(start.request, operationId, { vaultBinding })
    if (issued.kind !== 'credentials') throw new Error('Expected one-time credentials')
    const claims = jwt.verify<JwtPayload>(issued.accessToken)
    expect((await authorityReader(db).read(claims, start.request.browser)).kind).toBe('denied')
    const publication = {
      proof: PendingSessionProof.verify(issued.accessToken, jwt, 'browser_publication'),
      continuation: start.request.credential,
      operationId,
      audience: start.request.audience,
      bindingHash: start.request.bindingHash,
      browser: start.request.browser,
      vaultBinding,
      receipt: issued.receipt,
      handoff: null,
    }
    expect(await db.$transaction((tx) => settlePublication(tx, publication))).toEqual({
      outcome: 'published',
    })
    expect(await authorityReader(db).read(claims, start.request.browser)).toEqual({
      kind: 'admitted',
      operator: true,
    })
    expect(await db.$transaction((tx) => settlePublication(tx, publication))).toEqual({
      outcome: 'published',
    })
    expect((await authorityReader(db).read(claims, f.requestBinding)).kind).toBe('denied')
    expect(
      await db.mfaRecoveryCode.count({ where: { userId: f.user.id, consumedAt: { not: null } } })
    ).toBe(1)
    expect(await db.authSessionFamily.count({ where: { userId: f.user.id } })).toBe(2)
    expect(await db.authSessionFamily.findUnique({ where: { id: claims.fid! } })).toMatchObject({
      mfaMethod: 'recovery_code',
      recoveryGeneration: 1,
      primaryMethod: 'password',
    })
  })
})
