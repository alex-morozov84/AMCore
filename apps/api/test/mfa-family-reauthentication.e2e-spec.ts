import { randomUUID } from 'node:crypto'

import { MfaFamilyReauthenticationService } from '../src/core/auth/mfa/mfa-family-reauthentication.service.js'
import { continuationHash, type FlowRequest } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'
import { verificationFixture } from './mfa-verification.fixture.js'

describe('Reauthentication commits only into its exact source family', () => {
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

  async function prepared(proofWindowSeconds = 600) {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const now = await mfaDatabaseClock(db)
    await db.mfaAccount.update({ where: { userId: f.user.id }, data: { codeGeneration: 1 } })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: {
        primaryAt: new Date(now.getTime() - 700_000),
        mfaAt: new Date(now.getTime() - 700_000),
      },
    })
    const g = await db.authSessionFamily.create({
      data: {
        id: randomUUID(),
        userId: f.user.id,
        securityVersion: 3,
        publicationState: 'published',
        expiresAt: f.family.expiresAt,
      },
    })
    const credential = mfaCredential()
    const proofs = {
      primary: {
        eventId: randomUUID(),
        method: 'password',
        verifiedAt: now.toISOString(),
        origin: { kind: 'flow', flowId: f.flow.id },
      },
      secondFactor: {
        eventId: randomUUID(),
        method: 'recovery_code',
        factorVersion: 1,
        recoveryGeneration: 1,
        verifiedAt: now.toISOString(),
        origin: { kind: 'flow', flowId: f.flow.id },
      },
    }
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: {
        credentialHash: continuationHash(credential)!,
        browserContextId: f.requestBinding.contextId,
        publicationGeneration: 1,
        data: { proofs, proofWindowSeconds },
      },
    })
    const request: FlowRequest = {
      credential,
      purpose: 'reauthenticate',
      audience: 'product',
      bindingHash: f.requestBinding.bindingHash,
      browser: f.requestBinding,
    }
    const service = new MfaFamilyReauthenticationService(
      db as unknown as PrismaService,
      verificationFixture(fixture).events
    )
    return { ...f, g, request, service, proofs }
  }

  it('updates F once, preserves event times and never changes G or credentials', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const sessions = await db.session.findMany()
    const operationId = randomUUID()
    expect(await f.service.complete(f.request, operationId)).toEqual({
      outcome: 'completed',
      requiredProofs: [],
    })
    const committed = await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    expect(committed).toMatchObject({
      primaryProofId: f.proofs.primary.eventId,
      mfaProofId: f.proofs.secondFactor.eventId,
      mfaAt: new Date(f.proofs.secondFactor.verifiedAt),
      recoveryGeneration: 1,
    })
    await db.mfaAccount.update({ where: { userId: f.user.id }, data: { codeGeneration: 2 } })
    expect(await f.service.complete(f.request, operationId)).toEqual({
      outcome: 'completed',
      requiredProofs: [],
    })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(committed)
    expect(await db.authSessionFamily.findUnique({ where: { id: f.g.id } })).toEqual(f.g)
    expect(await db.session.findMany()).toEqual(sessions)
    expect(await db.authSessionFamily.count()).toBe(2)
    expect(
      await db.auditLog.count({ where: { actorId: f.user.id, action: 'auth.step_up_succeeded' } })
    ).toBe(1)
  })

  it('honors a shorter recorded window instead of treating any ten-minute proof as fresh', async () => {
    const db = fixture.clients[0]!
    const f = await prepared(60)
    const old = new Date((await mfaDatabaseClock(db)).getTime() - 61_000)
    f.proofs.secondFactor.verifiedAt = old.toISOString()
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: {
        data: {
          proofs: f.proofs,
          proofWindowSeconds: 60,
        },
      },
    })
    await expect(f.service.complete(f.request, randomUUID())).resolves.toEqual({
      outcome: 'proof_required',
      requiredProofs: ['second_factor'],
    })
    expect(await db.mfaOperation.count()).toBe(0)
  })

  it('a replay reports current F authority and cannot claim that new local proofs were committed', async () => {
    const db = fixture.clients[0]!
    const f = await prepared(60)
    const completedId = randomUUID()
    await expect(f.service.complete(f.request, completedId)).resolves.toMatchObject({
      outcome: 'completed',
    })
    const now = await mfaDatabaseClock(db)
    const stale = await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: {
        mfaAt: new Date(now.getTime() - 61_000),
      },
    })
    f.proofs.primary.eventId = randomUUID()
    f.proofs.secondFactor.eventId = randomUUID()
    f.proofs.primary.verifiedAt = now.toISOString()
    f.proofs.secondFactor.verifiedAt = now.toISOString()
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: {
        data: {
          proofs: f.proofs,
          proofWindowSeconds: 60,
        },
      },
    })
    await expect(f.service.complete(f.request, completedId)).resolves.toEqual({
      outcome: 'proof_required',
      requiredProofs: ['second_factor'],
    })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(stale)
    await expect(f.service.complete(f.request, randomUUID())).resolves.toMatchObject({
      outcome: 'completed',
    })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      mfaProofId: f.proofs.secondFactor.eventId,
    })
  })

  it('cannot use both local proofs after source revocation while G stays live', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: await mfaDatabaseClock(db) },
    })
    expect(await f.service.complete(f.request, randomUUID())).toEqual({
      outcome: 'restart_required',
    })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.g.id } })).toEqual(f.g)
    expect(await db.mfaOperation.count()).toBe(0)
  })

  it('requires a replacement proof when its local backup generation changes before commit', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    await db.mfaAccount.update({ where: { userId: f.user.id }, data: { codeGeneration: 2 } })
    expect(await f.service.complete(f.request, randomUUID())).toEqual({
      outcome: 'proof_required',
      requiredProofs: ['second_factor'],
    })
    expect(await db.mfaOperation.count()).toBe(0)
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      primaryProofId: f.family.primaryProofId,
    })
  })
})
