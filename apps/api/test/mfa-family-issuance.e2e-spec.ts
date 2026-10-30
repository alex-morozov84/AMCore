import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'

import type { JwtPayload } from '@amcore/shared'

import { readFlowProofs } from '../src/core/auth/mfa/mfa-flow-state.js'
import { settlePublication } from '../src/core/auth/mfa/mfa-publication-settlement.js'
import { PendingSessionProof } from '../src/core/auth/mfa/pending-session-proof.js'

import { authorityReader } from './mfa-authority.fixture.js'
import { familyIssuanceFixture } from './mfa-family-issuance.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Family issuance from independent durable proof', () => {
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

  it('returns credentials once, keeps browser access pending and publishes only under the exact receipt', async () => {
    const db = fixture.clients[0]!
    const f = await familyIssuanceFixture(fixture)
    const result = await f.service.complete(f.request, f.operationId, {
      vaultBinding: f.vaultBinding,
    })
    if (result.kind !== 'credentials') throw new Error('Expected winning credential response')
    const claims = f.jwt.verify<JwtPayload>(result.accessToken)
    expect(claims).toMatchObject({
      fid: result.publication.familyId,
      sid: result.publication.sessionId,
      securityVersion: 3,
      browserBound: true,
    })
    expect((await authorityReader(db).read(claims, f.request.browser)).kind).toBe('denied')
    expect(
      await f.service.complete(f.request, f.operationId, { vaultBinding: f.vaultBinding })
    ).toEqual({
      kind: 'issued',
      status: { state: 'pending', familyId: result.publication.familyId },
    })
    expect(await db.authSessionFamily.count({ where: { userId: f.user.id } })).toBe(2)
    expect(
      await db.$transaction((tx) =>
        settlePublication(tx, {
          proof: PendingSessionProof.verify(result.accessToken, f.jwt, 'browser_publication'),
          continuation: f.request.credential,
          operationId: f.operationId,
          audience: f.request.audience,
          bindingHash: f.request.bindingHash,
          browser: f.request.browser,
          vaultBinding: f.vaultBinding,
          receipt: result.receipt,
          handoff: null,
        })
      )
    ).toEqual({ outcome: 'published' })
    expect(await authorityReader(db).read(claims, f.request.browser)).toEqual({
      kind: 'admitted',
      operator: true,
    })
    const durable = JSON.stringify([
      await db.mfaFlow.findMany(),
      await db.mfaOperation.findMany(),
      await db.authSessionFamily.findMany(),
    ])
    for (const value of [result.accessToken, result.refreshToken, result.receipt!])
      expect(durable).not.toContain(value)
    expect(
      (await db.session.findUniqueOrThrow({ where: { id: result.publication.sessionId } }))
        .refreshToken
    ).toBe(f.tokens.hashRefreshToken(result.refreshToken))
  })

  it.each([
    { direct: true, oauth: false },
    { direct: false, oauth: true },
  ])('keeps ordinary semantics for direct=$direct OAuth=$oauth', async (options) => {
    const db = fixture.clients[0]!
    const f = await familyIssuanceFixture(fixture, { ...options, protected: false })
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'prepared' } })
    const result = await f.service.complete(f.request, f.operationId, {
      vaultBinding: f.vaultBinding,
    })
    if (result.kind !== 'credentials') throw new Error('Expected ordinary credentials')
    expect(result.receipt).toBeNull()
    const claims = f.jwt.verify<JwtPayload>(result.accessToken)
    expect(claims.browserBound).toBe(options.direct ? undefined : true)
    expect(
      await db.authSessionFamily.findUnique({ where: { id: result.publication.familyId } })
    ).toMatchObject({
      publicationState: options.direct ? 'published' : 'pending',
      primaryMethod: options.oauth ? 'oauth' : 'password',
    })
    expect((await authorityReader(db).read(claims, f.request.browser)).kind).toBe(
      options.direct ? 'admitted' : 'denied'
    )
    expect(
      (await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).revokedAt !==
        null
    ).toBe(!options.direct)
  })

  it('does not turn session-derived fresh password/MFA into an independent login family', async () => {
    const db = fixture.clients[0]!
    const f = await familyIssuanceFixture(fixture, { sourceSession: true })
    expect(
      await f.service.complete(f.request, f.operationId, { vaultBinding: f.vaultBinding })
    ).toEqual({ kind: 'restart_required' })
    expect(await db.authSessionFamily.count()).toBe(1)
    expect(await db.mfaOperation.count()).toBe(0)
  })

  it('preserves local factor proof when only the password is stale and requires local proofs after protected OAuth', async () => {
    const db = fixture.clients[0]!
    const f = await familyIssuanceFixture(fixture)
    const flow = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })
    const proofs = readFlowProofs(flow.data)
    proofs.primary!.verifiedAt = new Date(Date.now() - 600_001).toISOString()
    await db.mfaFlow.update({ where: { id: flow.id }, data: { data: { proofs } } })
    expect(
      await f.service.complete(f.request, f.operationId, { vaultBinding: f.vaultBinding })
    ).toEqual({ kind: 'proof_required', requiredProofs: ['password'] })
    expect(
      readFlowProofs((await db.mfaFlow.findUniqueOrThrow({ where: { id: flow.id } })).data)
        .secondFactor
    ).toEqual(proofs.secondFactor)
    await db.mfaFlow.update({
      where: { id: flow.id },
      data: {
        data: {
          proofs: { primary: null, secondFactor: null },
          identity: {
            method: 'oauth',
            eventId: randomUUID(),
            verifiedAt: new Date().toISOString(),
            securityVersion: 3,
          },
        },
      },
    })
    expect(
      await f.service.complete(f.request, f.operationId, { vaultBinding: f.vaultBinding })
    ).toEqual({ kind: 'proof_required', requiredProofs: ['password', 'second_factor'] })
    expect(await db.authSessionFamily.count()).toBe(1)
  })

  it('rolls a signing failure back without reviving the previous browser login or erasing prior proof', async () => {
    const db = fixture.clients[0]!
    const f = await familyIssuanceFixture(fixture)
    const before = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })
    jest.spyOn(f.tokens, 'generateAccessToken').mockImplementationOnce(() => {
      throw new Error('signing failed')
    })
    await expect(
      f.service.complete(f.request, f.operationId, { vaultBinding: f.vaultBinding })
    ).rejects.toThrow('signing failed')
    expect(await db.authSessionFamily.count()).toBe(1)
    expect(await db.session.count()).toBe(1)
    expect(await db.mfaOperation.count()).toBe(0)
    expect(await db.mfaFlow.findUnique({ where: { id: f.flow.id } })).toEqual(before)
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      revokedAt: expect.any(Date),
    })
    expect(
      await db.browserAuthContext.findUnique({ where: { id: f.request.browser!.contextId } })
    ).toMatchObject({ state: 'reserved', generation: 2 })
  })
})
