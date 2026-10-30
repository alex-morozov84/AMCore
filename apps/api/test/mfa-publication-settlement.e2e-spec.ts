import type { PublicationCommand } from '../src/core/auth/mfa/mfa-publication-authority.js'
import { settlePublication } from '../src/core/auth/mfa/mfa-publication-settlement.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'

import { authorityReader } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'
import { pendingPublication, publicationProof } from './mfa-publication.fixture.js'

describe('Pending identity confirms publication without ordinary pending rights', () => {
  const fixture = new MfaProofFixture()
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    const db = fixture.clients[0]!
    await db.user.deleteMany()
    await db.organization.deleteMany()
    await db.browserAuthContext.deleteMany()
    await db.mfaProtocol.upsert({
      where: { id: 'platform' },
      create: { id: 'platform', state: 'prepared' },
      update: { state: 'prepared', version: 1 },
    })
  })
  const settle = (command: PublicationCommand) =>
    fixture.clients[1]!.$transaction((tx) => settlePublication(tx, command), {
      maxWait: 2000,
      timeout: 4000,
    })

  it.each([
    { label: 'ordinary password', protected: false, oauth: false },
    { label: 'ordinary OAuth identity', protected: false, oauth: true },
    { label: 'protected local MFA', protected: true, oauth: false },
  ])(
    'confirms $label invitation and family together, leaving membership for separate consent',
    async (options) => {
      const db = fixture.clients[0]!
      const f = await pendingPublication(fixture, { ...options, invitation: true })
      if (options.protected)
        await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'active' } })
      const reader = authorityReader(fixture.clients[1]!)
      expect((await reader.read(f.claims, f.requestBinding)).kind).toBe('denied')
      expect(await settle(f.command)).toEqual({ outcome: 'published' })
      expect(
        await db.invitationAuthHandoff.findUnique({
          where: { attemptId: f.record.invitation!.attemptId },
        })
      ).toMatchObject({ status: 'confirmed' })
      expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
        publicationState: 'published',
      })
      expect((await reader.read(f.claims, f.requestBinding)).kind).toBe('admitted')
      expect(await db.orgMember.count({ where: { userId: f.user.id } })).toBe(0)
      // Later expiry of the old pending deadline does not undo a committed publication.
      await db.invitationAuthHandoff.update({
        where: { attemptId: f.record.invitation!.attemptId },
        data: { deadline: new Date(0) },
      })
      await db.authSessionFamily.update({
        where: { id: f.family.id },
        data: { publicationDeadline: new Date(0) },
      })
      expect(await settle(f.command)).toEqual({ outcome: 'published' })
      expect(await db.authSessionFamily.count({ where: { userId: f.user.id } })).toBe(1)
      expect(await db.session.count({ where: { userId: f.user.id } })).toBe(1)
      expect(await db.mfaOperation.count()).toBe(1)
    }
  )

  it('publishes ordinary non-invitation browser login without an MFA receipt', async () => {
    const f = await pendingPublication(fixture)
    expect(f.command.receipt).toBeNull()
    expect(await settle(f.command)).toEqual({ outcome: 'published' })
    expect(await fixture.clients[0]!.mfaFactor.count()).toBe(0)
  })

  it('uses the same atomic invitation settlement for an independent protected receipt without inventing browser fields', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture, { direct: true, protected: true, invitation: true })
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'active' } })
    expect(f.command.browser).toBeNull()
    expect(await settle(f.command)).toEqual({ outcome: 'published' })
    expect(
      await db.invitationAuthHandoff.findUnique({
        where: { attemptId: f.record.invitation!.attemptId },
      })
    ).toMatchObject({ status: 'confirmed' })
    expect(await db.orgMember.count()).toBe(0)
  })

  it('refuses ordinary publisher fallback even when stored operation metadata omits an existing invitation tag', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture, { invitation: true })
    const generic = { ...f.command, proof: publicationProof(f.token, 'browser_publication') }
    expect(await settle(generic)).toEqual({ outcome: 'changed' })
    await db.mfaOperation.update({
      where: { id: f.command.operationId },
      data: { result: { ...f.record, invitation: null } },
    })
    expect(await settle({ ...generic, handoff: null })).toEqual({ outcome: 'changed' })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      publicationState: 'pending',
    })
    expect(
      await db.invitationAuthHandoff.findUnique({
        where: { attemptId: f.record.invitation!.attemptId },
      })
    ).toMatchObject({ status: 'pending' })
  })

  it('refuses wrong browser/vault/receipt proof and omission of the server-required MFA receipt', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture, { protected: true, invitation: true })
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'active' } })
    for (const command of [
      { ...f.command, receipt: null },
      { ...f.command, receipt: mfaCredential() },
      { ...f.command, vaultBinding: mfaCredential() },
      { ...f.command, browser: { ...f.requestBinding, generation: 2 } },
      { ...f.command, browser: { ...f.requestBinding, audience: 'console' as const } },
      { ...f.command, handoff: { ...f.command.handoff!, cleanupKeyHash: 'wrong' } },
    ])
      expect(await settle(command)).toEqual({ outcome: 'changed' })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      publicationState: 'pending',
    })
  })

  it('rolls back handoff, family and browser together after an enclosing failure', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture, { invitation: true })
    await expect(
      db.$transaction(async (tx) => {
        expect(await settlePublication(tx, f.command)).toEqual({ outcome: 'published' })
        throw new Error('publication transaction failed')
      })
    ).rejects.toThrow('publication transaction failed')
    expect(
      await db.invitationAuthHandoff.findUnique({
        where: { attemptId: f.record.invitation!.attemptId },
      })
    ).toMatchObject({ status: 'pending' })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      publicationState: 'pending',
    })
    expect(
      await db.browserAuthContext.findUnique({ where: { id: f.requestBinding.contextId } })
    ).toMatchObject({ state: 'reserved', currentFamilyId: null })
  })

  it('rejects first settlement after deadline and rejects later supersession without publishing old authority', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture, { invitation: true })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { publicationDeadline: new Date(0) },
    })
    expect(await settle(f.command)).toEqual({ outcome: 'changed' })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { publicationDeadline: new Date(Date.now() + 60_000) },
    })
    await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { generation: 2 },
    })
    expect(await settle(f.command)).toEqual({ outcome: 'changed' })
    expect(
      await db.invitationAuthHandoff.findUnique({
        where: { attemptId: f.record.invitation!.attemptId },
      })
    ).toMatchObject({ status: 'pending' })
  })
})
