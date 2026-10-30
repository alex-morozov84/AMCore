import { randomUUID } from 'node:crypto'

import { continuationHash, type FlowRequest } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { MfaSeedDraftService } from '../src/core/auth/mfa/mfa-seed-draft.service.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

/** Existing committed family evidence, not an actual settings HTTP adapter. */
describe('Replacement draft preserves the old app and exact source authority', () => {
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

  async function prepared() {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const credential = mfaCredential()
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: {
        purpose: 'replace_factor',
        credentialHash: continuationHash(credential)!,
        browserContextId: f.requestBinding.contextId,
        publicationGeneration: 1,
        data: {
          proofs: {
            primary: {
              method: 'password',
              eventId: randomUUID(),
              verifiedAt: f.family.primaryAt!.toISOString(),
              origin: { kind: 'family', familyId: f.family.id },
            },
            secondFactor: {
              method: 'totp',
              eventId: randomUUID(),
              factorVersion: 1,
              verifiedAt: f.family.mfaAt!.toISOString(),
              origin: { kind: 'family', familyId: f.family.id },
            },
          },
        },
      },
    })
    const request: FlowRequest = {
      credential,
      purpose: 'replace_factor',
      audience: 'product',
      bindingHash: f.requestBinding.bindingHash,
      browser: f.requestBinding,
    }
    const service = new MfaSeedDraftService(db as unknown as PrismaService, fixture.codec, {
      consume: async () => undefined,
    } as never)
    return { ...f, request, service }
  }

  it('creates an unbound replacement while leaving old factor, codes, epoch and family unchanged', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    await db.$transaction((tx) => fixture.first.replaceBackupCodes(tx, f.user.id, 3, 0))
    const factor = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    const codes = await db.mfaRecoveryCode.findMany()
    expect((await f.service.open(f.request, randomUUID(), false, 'source')).outcome).toBe('seed')
    expect(await db.mfaFactor.findUnique({ where: { userId: f.user.id } })).toEqual(factor)
    expect(await db.mfaRecoveryCode.findMany()).toEqual(codes)
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(f.family)
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 3,
      setupComplete: true,
    })
  })

  it('requires only the stale password and does not create a draft first', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const now = await mfaDatabaseClock(db)
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { primaryAt: new Date(now.getTime() - 700_000) },
    })
    expect(await f.service.open(f.request, randomUUID(), false, 'source')).toEqual({
      outcome: 'proof_required',
      requiredProofs: ['password'],
    })
    expect(await db.mfaOperation.count()).toBe(0)
  })

  it('refuses to reopen or regenerate after source revocation', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const operationId = randomUUID()
    expect((await f.service.open(f.request, operationId, false, 'source')).outcome).toBe('seed')
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: await mfaDatabaseClock(db) },
    })
    const original = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })
    expect(await f.service.open(f.request, operationId, false, 'source')).toEqual({
      outcome: 'restart_required',
    })
    expect(await f.service.open(f.request, randomUUID(), true, 'source')).toEqual({
      outcome: 'restart_required',
    })
    expect(await db.mfaFlow.findUnique({ where: { id: f.flow.id } })).toEqual(original)
    expect(await db.mfaFactor.count()).toBe(1)
  })
})
