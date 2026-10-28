import { randomUUID } from 'node:crypto'

import * as argon2 from 'argon2'

import { readSeedDraft } from '../src/core/auth/mfa/mfa-seed-draft.js'
import { MfaSeedDraftService } from '../src/core/auth/mfa/mfa-seed-draft.service.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type { PrismaService } from '../src/prisma/index.js'

import { loginStartFixture } from './mfa-login-start.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

const password = '<fake-isolated-seed-draft-password>'

describe('Encrypted unbound seed draft under exact initial-setup authority', () => {
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

  async function prepared() {
    const db = fixture.clients[0]!
    const f = await loginStartFixture(fixture, hash)
    await db.mfaFactor.delete({ where: { userId: f.user.id } })
    await db.mfaAccount.update({ where: { userId: f.user.id }, data: { setupComplete: false } })
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
    if (start.kind !== 'mfa' || !start.setupRequired) throw new Error('Expected initial setup')
    const service = new MfaSeedDraftService(
      db as unknown as PrismaService,
      fixture.codec,
      f.source as never
    )
    return { ...f, start, drafts: service }
  }

  it('reopens only its current unbound seed without storing plaintext or creating factor/session authority', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const operationId = randomUUID()
    const first = await f.drafts.open(f.start.request, operationId, false, 'source')
    if (first.outcome !== 'seed') throw new Error('Expected seed')
    expect(first.otpauthUri).toContain('otpauth://totp/')
    expect(first.expiresAt).toEqual(f.start.expiresAt)
    expect(await f.drafts.open(f.start.request, operationId, false, 'source')).toEqual(first)
    expect(await f.drafts.open(f.start.request, randomUUID(), false, 'source')).toEqual(first)
    const flow = await db.mfaFlow.findUniqueOrThrow({ where: { id: f.start.flowId } })
    const draft = readSeedDraft(flow.data)!
    expect(fixture.codec.decrypt(f.user.id, draft.factorId, draft.keyId, draft.encryptedSeed)).toBe(
      first.secret
    )
    expect(JSON.stringify([flow, await db.mfaOperation.findMany()])).not.toContain(first.secret)
    expect(await db.mfaFactor.count()).toBe(0)
    expect(await db.mfaRecoveryCode.count()).toBe(0)
    expect(await db.session.count({ where: { revokedAt: null } })).toBe(0)
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 3,
      setupComplete: false,
    })
    expect(
      (await db.mfaAttemptBudget.findUniqueOrThrow({ where: { userId: f.user.id } })).starts
    ).toHaveLength(1)
  })

  it('shares five-start debt with regeneration and never replays a replaced draft', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const operationId = randomUUID()
    const first = await f.drafts.open(f.start.request, operationId, false, 'source')
    if (first.outcome !== 'seed') throw new Error('Expected seed')
    for (let n = 0; n < 4; n++) {
      const next = await f.drafts.open(f.start.request, randomUUID(), true, 'source')
      if (next.outcome !== 'seed') throw new Error('Expected regenerated seed')
      expect(next.secret).not.toBe(first.secret)
      expect(next.expiresAt).toEqual(first.expiresAt)
    }
    expect((await f.drafts.open(f.start.request, randomUUID(), true, 'source')).outcome).toBe(
      'limited'
    )
    expect(await f.drafts.open(f.start.request, operationId, false, 'source')).toEqual({
      outcome: 'restart_required',
    })
    expect(
      (await db.mfaAttemptBudget.findUniqueOrThrow({ where: { userId: f.user.id } })).starts
    ).toHaveLength(5)
    expect(await db.mfaFactor.count()).toBe(0)
  })

  it('refuses a second device without evicting the first unverified seed', async () => {
    const f = await prepared()
    const first = await f.drafts.open(f.start.request, randomUUID(), false, 'source')
    const second = await f.service.password(
      f.user.email,
      password,
      'source',
      { kind: 'direct' },
      randomUUID()
    )
    if (second.kind !== 'mfa') throw new Error('Expected second setup')
    expect(await f.drafts.open(second.request, randomUUID(), false, 'source')).toEqual({
      outcome: 'draft_exists',
    })
    expect(await f.drafts.open(f.start.request, randomUUID(), false, 'source')).toEqual(first)
  })

  it('requires the stale password again inside the original setup deadline', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const now = await mfaDatabaseClock(db)
    await db.mfaFlow.update({
      where: { id: f.start.flowId },
      data: {
        data: {
          proofs: {
            primary: {
              method: 'password',
              eventId: randomUUID(),
              verifiedAt: new Date(now.getTime() - 700_000).toISOString(),
              origin: { kind: 'flow', flowId: f.start.flowId },
            },
            secondFactor: null,
          },
        },
      },
    })
    expect(await f.drafts.open(f.start.request, randomUUID(), false, 'source')).toEqual({
      outcome: 'proof_required',
      requiredProofs: ['password'],
    })
    expect(await db.mfaFlow.findUnique({ where: { id: f.start.flowId } })).toMatchObject({
      expiresAt: f.start.expiresAt,
    })
    expect(await db.mfaOperation.count({ where: { kind: 'open_seed' } })).toBe(0)
  })
})
