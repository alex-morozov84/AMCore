import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as argon2 from 'argon2'

import type { JwtPayload } from '@amcore/shared'

import { MfaFamilyIssuanceService } from '../src/core/auth/mfa/mfa-family-issuance.service.js'
import { lockMfaFlow } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { settlePublication } from '../src/core/auth/mfa/mfa-publication-settlement.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { PendingSessionProof } from '../src/core/auth/mfa/pending-session-proof.js'
import { TokenService } from '../src/core/auth/token.service.js'
import { EnvService } from '../src/env/env.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { authorityReader } from './mfa-authority.fixture.js'
import { factorBindingFixture, seedProof } from './mfa-factor-binding.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

const password = '<fake-isolated-factor-replacement-password>'

describe('Exact source-family replacement and setup publication', () => {
  const fixture = new MfaProofFixture()
  let hash: string
  beforeAll(async () => {
    hash = await argon2.hash(password)
    await fixture.start()
  }, 120000)
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

  it('keeps only the committed setup successor after intentional source revocation', async () => {
    const db = fixture.clients[0]!
    const f = await factorBindingFixture(fixture, hash, password, true)
    await db.$transaction((tx) => fixture.first.replaceBackupCodes(tx, f.user.id, 3, 0))
    const oldFactor = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    const result = await f.binding.bind(
      f.request,
      randomUUID(),
      await seedProof(fixture, f.seed),
      'source'
    )
    if (result.outcome !== 'bound') throw new Error('Expected replacement')
    const s = result.successor
    expect(s.generation).toBe(2)
    expect(await db.mfaFactor.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      version: 2,
    })
    expect(await db.mfaFactor.findUnique({ where: { id: oldFactor.id } })).toBeNull()
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      publicationState: 'retired',
      revokedAt: expect.any(Date),
    })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: await mfaDatabaseClock(db) },
    })
    expect(await db.$transaction((tx) => lockMfaFlow(tx, f.request))).toBeNull()
    expect(await db.$transaction((tx) => lockMfaFlow(tx, s.request))).not.toBeNull()
    expect(await f.ack.acknowledge(s.request, randomUUID(), 2, 'source')).toEqual({
      outcome: 'acknowledged',
      generation: 2,
    })
    expect(
      await db.auditLog.count({ where: { actorId: f.user.id, action: 'auth.mfa_factor_replaced' } })
    ).toBe(1)
  })

  it('refuses replacement if an external revocation wins before binding', async () => {
    const db = fixture.clients[0]!
    const f = await factorBindingFixture(fixture, hash, password, true)
    const factor = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: await mfaDatabaseClock(db) },
    })
    expect(
      await f.binding.bind(f.request, randomUUID(), await seedProof(fixture, f.seed), 'source')
    ).toEqual({ outcome: 'restart_required' })
    expect(await db.mfaFactor.findUnique({ where: { userId: f.user.id } })).toEqual(factor)
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 3,
      setupComplete: true,
    })
    expect(await db.mfaOperation.count({ where: { kind: 'setup_transfer' } })).toBe(0)
  })

  it('refuses a substituted transfer without undoing the bound factor', async () => {
    const db = fixture.clients[0]!
    const f = await factorBindingFixture(fixture, hash, password, true)
    const result = await f.binding.bind(
      f.request,
      randomUUID(),
      await seedProof(fixture, f.seed),
      'source'
    )
    if (result.outcome !== 'bound') throw new Error('Expected replacement')
    await db.mfaFlow.update({
      where: { id: result.successor.flowId },
      data: { transferId: randomUUID() },
    })
    expect(await db.$transaction((tx) => lockMfaFlow(tx, result.successor.request))).toBeNull()
    expect(
      await f.ack.acknowledge(
        result.successor.request,
        randomUUID(),
        result.successor.generation,
        'source'
      )
    ).toEqual({ outcome: 'restart_required' })
    expect(await db.mfaFactor.count()).toBe(1)
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 4,
      setupComplete: false,
    })
  })

  it('issues no family before code save and publishes the exact setup result after it', async () => {
    const db = fixture.clients[0]!
    const f = await factorBindingFixture(fixture, hash, password)
    const bound = await f.binding.bind(
      f.request,
      randomUUID(),
      await seedProof(fixture, f.seed),
      'source'
    )
    if (bound.outcome !== 'bound') throw new Error('Expected binding')
    const s = bound.successor
    const jwt = new JwtService({
      secret: '<fake-local-setup-publisher-signing-key-at-least-32>',
      signOptions: { expiresIn: '15m' },
    })
    const tokens = new TokenService(
      jwt,
      new EnvService(new ConfigService({ JWT_REFRESH_DAYS: 30 }))
    )
    const issuer = new MfaFamilyIssuanceService(db as unknown as PrismaService, tokens)
    const operationId = randomUUID()
    const vaultBinding = mfaCredential()
    expect(await issuer.complete(s.request, operationId, { vaultBinding })).toEqual({
      kind: 'enrollment_required',
    })
    expect(await f.ack.acknowledge(s.request, randomUUID(), s.generation, 'source')).toEqual({
      outcome: 'acknowledged',
      generation: s.generation,
    })
    const issued = await issuer.complete(s.request, operationId, { vaultBinding })
    if (issued.kind !== 'credentials') throw new Error('Expected one-time credentials')
    expect(issued.publication.transferId).toBe(s.transferId)
    const claims = jwt.verify<JwtPayload>(issued.accessToken)
    expect((await authorityReader(db).read(claims, s.request.browser)).kind).toBe('denied')
    // A committed family proof survives later backup generation changes.
    await db.mfaAccount.update({
      where: { userId: f.user.id },
      data: { codeGeneration: { increment: 1 } },
    })
    const command = {
      proof: PendingSessionProof.verify(issued.accessToken, jwt, 'browser_publication'),
      continuation: s.request.credential,
      operationId,
      audience: s.request.audience,
      bindingHash: s.request.bindingHash,
      browser: s.request.browser,
      vaultBinding,
      receipt: issued.receipt,
      handoff: null,
    }
    expect(await db.$transaction((tx) => settlePublication(tx, command))).toEqual({
      outcome: 'published',
    })
    expect(await db.$transaction((tx) => settlePublication(tx, command))).toEqual({
      outcome: 'published',
    })
    expect(await authorityReader(db).read(claims, s.request.browser)).toEqual({
      kind: 'admitted',
      operator: true,
    })
    expect((await authorityReader(db).read(f.claims, f.requestBinding)).kind).toBe('denied')
  })
})
