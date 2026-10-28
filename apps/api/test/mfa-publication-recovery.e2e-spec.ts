import { randomUUID } from 'node:crypto'

import type { FlowRequest } from '../src/core/auth/mfa/mfa-flow-lock.js'
import {
  publicationStatus,
  retirePublication,
} from '../src/core/auth/mfa/mfa-publication-recovery.js'
import { settlePublication } from '../src/core/auth/mfa/mfa-publication-settlement.js'

import { MfaProofFixture } from './mfa-proof.fixture.js'
import { pendingPublication } from './mfa-publication.fixture.js'

function request(f: Awaited<ReturnType<typeof pendingPublication>>): FlowRequest {
  return {
    credential: f.command.continuation,
    purpose: 'login',
    audience: f.command.audience,
    bindingHash: f.command.bindingHash,
    browser: f.command.browser,
  }
}

describe('Lost publication response exposes only own nonsecret result or bounded compensation', () => {
  const fixture = new MfaProofFixture()
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    const db = fixture.clients[0]!
    await db.user.deleteMany()
    await db.organization.deleteMany()
    await db.browserAuthContext.deleteMany()
  })

  it('reads only pending metadata without changing proofs, deadlines or publication', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture, { invitation: true })
    const before = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })
    const family = await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    for (let i = 0; i < 2; i++) {
      expect(
        await db.$transaction((tx) => publicationStatus(tx, request(f), f.command.operationId))
      ).toEqual({ state: 'pending', familyId: f.family.id })
    }
    expect(await db.mfaFlow.findUnique({ where: { id: f.flow.id } })).toEqual(before)
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(family)
    expect(
      await db.invitationAuthHandoff.findUnique({
        where: { attemptId: f.record.invitation!.attemptId },
      })
    ).toMatchObject({ status: 'pending' })
  })

  it('retires exact pending invitation state even if the invitation expired; never accepts membership', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture, { invitation: true })
    await db.orgInvite.update({
      where: { id: f.record.invitation!.inviteId },
      data: { expiresAt: new Date(0) },
    })
    expect(
      await db.$transaction((tx) => retirePublication(tx, request(f), f.command.operationId))
    ).toEqual({ state: 'retired', familyId: f.family.id })
    expect(
      await db.invitationAuthHandoff.findUnique({
        where: { attemptId: f.record.invitation!.attemptId },
      })
    ).toMatchObject({ status: 'aborted' })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      publicationState: 'retired',
      revokedAt: expect.any(Date),
    })
    expect(await db.session.findUnique({ where: { id: f.session.id } })).toMatchObject({
      revokedAt: expect.any(Date),
    })
    expect(
      await db.browserAuthContext.findUnique({ where: { id: f.requestBinding.contextId } })
    ).toMatchObject({ state: 'logged_out', currentFamilyId: null })
    expect(
      await db.$transaction((tx) => publicationStatus(tx, request(f), f.command.operationId))
    ).toEqual({ state: 'retired', familyId: f.family.id })
    expect(
      await db.$transaction((tx) => retirePublication(tx, request(f), f.command.operationId))
    ).toEqual({ state: 'retired', familyId: f.family.id })
    expect(await db.orgMember.count()).toBe(0)
  })

  it('preserves account epoch, enrolled factor and previously consumed backup codes during compensation', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture, { protected: true })
    // Precommitted proof fixture; this test covers compensation, not a full login endpoint.
    const set = await db.$transaction((tx) => fixture.first.replaceBackupCodes(tx, f.user.id, 3, 0))
    expect(
      await db.$transaction((tx) =>
        fixture.first.consume(tx, f.user.id, 3, { method: 'recovery_code', code: set!.codes[0]! })
      )
    ).not.toBeNull()
    const independent = await db.authSessionFamily.create({
      data: {
        id: randomUUID(),
        userId: f.user.id,
        securityVersion: 3,
        publicationState: 'published',
        expiresAt: f.family.expiresAt,
      },
    })
    expect(
      (await db.$transaction((tx) => retirePublication(tx, request(f), f.command.operationId)))
        .state
    ).toBe('retired')
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 3,
      required: true,
      setupComplete: true,
      codeGeneration: 1,
    })
    expect(await db.mfaFactor.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      version: 1,
      lastAcceptedStep: 42n,
    })
    expect(await db.authSessionFamily.findUnique({ where: { id: independent.id } })).toMatchObject({
      revokedAt: null,
    })
    expect(
      await db.$transaction((tx) =>
        fixture.first.consume(tx, f.user.id, 3, { method: 'recovery_code', code: set!.codes[0]! })
      )
    ).toBeNull()
    expect(
      await db.$transaction((tx) =>
        fixture.first.consume(tx, f.user.id, 3, { method: 'recovery_code', code: set!.codes[1]! })
      )
    ).toMatchObject({ method: 'recovery_code' })
  })

  it('does not revoke a published family through delayed compensation', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture)
    expect(await db.$transaction((tx) => settlePublication(tx, f.command))).toEqual({
      outcome: 'published',
    })
    const before = await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    expect(
      await db.$transaction((tx) => retirePublication(tx, request(f), f.command.operationId))
    ).toEqual({ state: 'published', familyId: f.family.id })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(before)
  })

  it('refuses stale browser revision, wrong binding, foreign operation and source-family reinterpretation', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture)
    for (const incoming of [
      { ...request(f), browser: null },
      { ...request(f), browser: { ...f.requestBinding, generation: 2 } },
      { ...request(f), bindingHash: 'other' },
    ])
      expect(
        await db.$transaction((tx) => retirePublication(tx, incoming, f.command.operationId))
      ).toEqual({ state: 'changed' })
    expect(await db.$transaction((tx) => retirePublication(tx, request(f), randomUUID()))).toEqual({
      state: 'changed',
    })
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: { authorityKind: 'session', sourceFamilyId: f.family.id, sourceSecurityVersion: 3 },
    })
    expect(
      await db.$transaction((tx) => retirePublication(tx, request(f), f.command.operationId))
    ).toEqual({ state: 'changed' })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      revokedAt: null,
      publicationState: 'pending',
    })
  })

  it('reports expiry without renewal and rolls retirement effects back on an enclosing failure', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture, { invitation: true })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { publicationDeadline: new Date(0) },
    })
    expect(
      await db.$transaction((tx) => publicationStatus(tx, request(f), f.command.operationId))
    ).toEqual({ state: 'expired', familyId: f.family.id })
    await expect(
      db.$transaction(async (tx) => {
        await retirePublication(tx, request(f), f.command.operationId)
        throw new Error('compensation transaction failed')
      })
    ).rejects.toThrow('compensation transaction failed')
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      publicationState: 'pending',
      revokedAt: null,
      publicationDeadline: new Date(0),
    })
    expect(
      await db.invitationAuthHandoff.findUnique({
        where: { attemptId: f.record.invitation!.attemptId },
      })
    ).toMatchObject({ status: 'pending' })
  })
})
