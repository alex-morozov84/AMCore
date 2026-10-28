import { randomUUID } from 'node:crypto'

import {
  continuationHash,
  type FlowRequest,
  lockMfaFlow,
} from '../src/core/auth/mfa/mfa-flow-lock.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { lockMfaAccounts } from '../src/core/auth/mfa/mfa-transaction.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

async function boundFlow(fixture: MfaProofFixture) {
  const f = await createAuthorityAccount(fixture)
  const credential = mfaCredential()
  await fixture.clients[0]!.mfaFlow.update({
    where: { id: f.flow.id },
    data: {
      credentialHash: continuationHash(credential)!,
      browserContextId: f.requestBinding.contextId,
      publicationGeneration: f.requestBinding.generation,
    },
  })
  const request: FlowRequest = {
    credential,
    purpose: 'reauthenticate',
    audience: 'product',
    bindingHash: f.requestBinding.bindingHash,
    browser: f.requestBinding,
  }
  return { ...f, request }
}

describe('Continuation authority on primary PostgreSQL', () => {
  const fixture = new MfaProofFixture()
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    await fixture.clients[0]!.user.deleteMany()
    await fixture.clients[0]!.browserAuthContext.deleteMany()
  })
  const read = (request: FlowRequest) =>
    fixture.clients[1]!.$transaction((tx) => lockMfaFlow(tx, request), {
      maxWait: 2000,
      timeout: 4000,
    })

  it('keeps exact F authority across refresh rows and refuses its revocation despite live G', async () => {
    const db = fixture.clients[0]!
    const f = await boundFlow(fixture)
    expect((await read(f.request))?.source?.id).toBe(f.family.id)
    await db.session.create({
      data: {
        userId: f.user.id,
        familyId: f.family.id,
        refreshToken: randomUUID(),
        expiresAt: f.family.expiresAt,
      },
    })
    expect((await read(f.request))?.source?.id).toBe(f.family.id)
    const independent = await db.authSessionFamily.create({
      data: {
        id: randomUUID(),
        userId: f.user.id,
        securityVersion: 3,
        publicationState: 'published',
        expiresAt: f.family.expiresAt,
      },
    })
    await db.$transaction(async (tx) => {
      const now = await lockMfaAccounts(tx, [f.user.id])
      await tx.authSessionFamily.update({ where: { id: f.family.id }, data: { revokedAt: now } })
    })
    expect(await read(f.request)).toBeNull()
    expect(await db.authSessionFamily.findUnique({ where: { id: independent.id } })).toMatchObject({
      revokedAt: null,
    })
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 3,
    })
    // Revoke-one is not a ban on a newly independently authorized login.
    const credential = mfaCredential()
    await db.mfaFlow.create({
      data: {
        userId: f.user.id,
        credentialHash: continuationHash(credential)!,
        purpose: 'login',
        authorityKind: 'identity',
        audience: 'direct',
        bindingHash: 'direct-binding',
        securityVersion: 3,
        expiresAt: f.flow.expiresAt,
      },
    })
    expect(
      (
        await read({
          credential,
          purpose: 'login',
          audience: 'direct',
          bindingHash: 'direct-binding',
          browser: null,
        })
      )?.source
    ).toBeNull()
  })

  it('requires exact incoming browser scope and rejects supersession', async () => {
    const db = fixture.clients[0]!
    const f = await boundFlow(fixture)
    for (const request of [
      { ...f.request, browser: null },
      { ...f.request, purpose: 'rotate_codes' as const },
      { ...f.request, audience: 'console' },
      { ...f.request, browser: { ...f.requestBinding, bindingHash: 'other' } },
      { ...f.request, browser: { ...f.requestBinding, generation: 2 } },
    ])
      expect(await read(request)).toBeNull()
    await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { generation: 2 },
    })
    expect(await read(f.request)).toBeNull()
    expect((await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })).attempts).toBe(0)
  })

  it('refuses exhausted, expired and unknown transfer authority without effects', async () => {
    const db = fixture.clients[0]!
    const f = await boundFlow(fixture)
    for (const data of [
      { attempts: 5 },
      { attempts: 0, expiresAt: new Date(0) },
      { expiresAt: f.flow.expiresAt, authorityKind: 'transfer' },
    ]) {
      await db.mfaFlow.update({ where: { id: f.flow.id }, data })
      expect(await read(f.request)).toBeNull()
    }
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      revokedAt: null,
    })
  })
})
