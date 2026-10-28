import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'

import { MfaRetentionService } from '../src/core/auth/mfa/mfa-retention.service.js'
import { lockRetentionCandidates } from '../src/core/auth/mfa/mfa-retention-locks.js'
import {
  pruneRetentionCandidates,
  retentionCandidates,
} from '../src/core/auth/mfa/mfa-retention-query.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type { ScheduledJobExecutor } from '../src/infrastructure/schedule/scheduled-job.executor.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Bounded expired MFA retention preserves factors, journals and session tombstones', () => {
  const fixture = new MfaProofFixture()
  const service = (): MfaRetentionService =>
    new MfaRetentionService(
      fixture.clients[0]! as unknown as PrismaService,
      {} as ScheduledJobExecutor
    )
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    const db = fixture.clients[0]!
    await db.user.deleteMany()
    await db.browserAuthContext.deleteMany()
  })
  afterEach(() => jest.restoreAllMocks())

  it('scrubs only expired flow data and never removes the independent bound factor or recent receipt', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const factor = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    const now = await mfaDatabaseClock(db)
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: {
        expiresAt: new Date(now.getTime() - 1),
        data: { seedDraft: { encryptedSeed: '<fake-expired-ciphertext>' } },
      },
    })
    const receipt = await db.mfaOperation.create({
      data: {
        id: randomUUID(),
        flowId: f.flow.id,
        kind: 'fixture_receipt',
        result: { outcome: 'completed' },
      },
    })
    const live = await db.mfaFlow.create({
      data: {
        userId: f.user.id,
        credentialHash: randomUUID(),
        purpose: 'initial_setup',
        authorityKind: 'identity',
        audience: 'direct',
        bindingHash: 'fixture',
        securityVersion: 3,
        expiresAt: new Date(now.getTime() + 60_000),
        data: { seedDraft: { encryptedSeed: '<fake-live-ciphertext>' } },
      },
    })
    await expect(service().prune('drafts')).resolves.toBe(1)
    expect((await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })).data).toEqual({})
    expect(await db.mfaFlow.findUniqueOrThrow({ where: { id: live.id } })).toEqual(live)
    expect(await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })).toEqual(factor)
    await expect(service().prune('receipts')).resolves.toBe(0)
    expect(await db.mfaOperation.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt)
  })

  it('retains receipts for 24 hours and refuses cascade deletion before receipt pruning', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const cutoff = new Date((await mfaDatabaseClock(db)).getTime() - 86400_000 - 1000)
    await db.mfaFlow.update({ where: { id: f.flow.id }, data: { expiresAt: cutoff } })
    const operation = await db.mfaOperation.create({
      data: {
        id: randomUUID(),
        flowId: f.flow.id,
        kind: 'fixture_receipt',
        result: { outcome: 'completed' },
      },
    })
    await expect(service().prune('flows')).resolves.toBe(0)
    await expect(service().prune('receipts')).resolves.toBe(0)
    await db.mfaOperation.update({ where: { id: operation.id }, data: { createdAt: cutoff } })
    await expect(service().prune('flows')).resolves.toBe(0)
    await expect(service().prune('receipts')).resolves.toBe(1)
    await expect(service().prune('flows')).resolves.toBe(1)
    expect(await db.mfaFactor.count({ where: { userId: f.user.id } })).toBe(1)
  })

  it('keeps unknown/longer retention and unexpired refresh evidence before deleting an expired family', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: { browserContextId: f.requestBinding.contextId },
    })
    const now = await mfaDatabaseClock(db)
    const past = new Date(now.getTime() - 1000)
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { expiresAt: past, revokedAt: past },
    })
    await expect(service().prune('families')).resolves.toBe(0)
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { retainUntil: new Date(now.getTime() + 60_000) },
    })
    await expect(service().prune('families')).resolves.toBe(0)
    await db.authSessionFamily.update({ where: { id: f.family.id }, data: { retainUntil: past } })
    await expect(service().prune('families')).resolves.toBe(0)
    await db.session.update({ where: { id: f.session.id }, data: { expiresAt: past } })
    await expect(service().prune('families')).resolves.toBe(1)
    await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { expiresAt: past },
    })
    await expect(service().prune('contexts')).resolves.toBe(0)
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: { expiresAt: new Date(now.getTime() - 2 * 86400_000) },
    })
    await expect(service().prune('flows')).resolves.toBe(1)
    await expect(service().prune('contexts')).resolves.toBe(1)
  })

  it('reports a bounded partial result when more than two 100-row flow batches remain', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const expired = new Date((await mfaDatabaseClock(db)).getTime() - 2 * 86400_000)
    await db.mfaFlow.delete({ where: { id: f.flow.id } })
    await db.mfaFlow.createMany({
      data: Array.from({ length: 201 }, () => ({
        userId: f.user.id,
        credentialHash: randomUUID(),
        purpose: 'login',
        authorityKind: 'identity',
        audience: 'direct',
        bindingHash: 'fixture',
        securityVersion: 3,
        expiresAt: expired,
      })),
    })
    await expect(service().sweep()).resolves.toMatchObject({
      outcome: 'partial',
      code: 'batch_limit',
      summary: {
        counts: { flows: 200, examined: 200, removed: 200, batches: 10, truncated: 1 },
        codes: [],
      },
    })
    expect(await db.mfaFlow.count({ where: { userId: f.user.id } })).toBe(1)
  })

  it('rechecks a stale expiry hint after the same ordered locks used by issuance', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const now = await mfaDatabaseClock(db)
    const past = new Date(now.getTime() - 1000)
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { expiresAt: past, retainUntil: past },
    })
    await db.session.update({ where: { id: f.session.id }, data: { expiresAt: past } })
    const hints = await retentionCandidates(db, 'families', now)
    expect(hints).toHaveLength(1)
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: {
        expiresAt: f.family.expiresAt,
        retainUntil: f.family.expiresAt,
      },
    })
    const removed = await db.$transaction(async (tx) => {
      await lockRetentionCandidates(tx, hints)
      return pruneRetentionCandidates(tx, 'families', hints, await mfaDatabaseClock(tx))
    })
    expect(removed).toBe(0)
    expect(await db.authSessionFamily.count({ where: { id: f.family.id } })).toBe(1)
  })

  it('reports failed prerequisites instead of success, preserving committed bucket counts', async () => {
    const s = service()
    jest.spyOn(s, 'prune').mockImplementation(async (bucket, examined) => {
      examined?.(1)
      if (bucket === 'drafts') return 1
      throw new Error('private failure text must not appear in evidence')
    })
    const result = await s.sweep()
    expect(result).toMatchObject({
      outcome: 'partial',
      code: 'retention_incomplete',
      summary: {
        counts: { drafts: 2, removed: 2, examined: 10, batches: 10 },
        codes: ['receipts', 'flows', 'families', 'contexts'],
      },
    })
    expect(JSON.stringify(result)).not.toContain('private failure')
  })
})
