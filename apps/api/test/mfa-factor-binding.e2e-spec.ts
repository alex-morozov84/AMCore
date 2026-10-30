import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import * as argon2 from 'argon2'

import { lockMfaFlow } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { flowData } from '../src/core/auth/mfa/mfa-flow-state.js'
import { MfaPasswordVerificationService } from '../src/core/auth/mfa/mfa-password-verification.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { factorBindingFixture, seedProof } from './mfa-factor-binding.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

const password = '<fake-isolated-factor-binding-password>'

describe('Durable initial factor bind, setup-only authority and generation acknowledgement', () => {
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

  it('binds and consumes the seed step once, then acknowledges only the exact saved generation', async () => {
    const db = fixture.clients[0]!
    const f = await factorBindingFixture(fixture, hash, password)
    const operationId = randomUUID()
    const proof = await seedProof(fixture, f.seed)
    const result = await f.binding.bind(f.request, operationId, proof, 'source')
    if (result.outcome !== 'bound') throw new Error('Expected durable binding')
    const s = result.successor
    expect(s.codes).toHaveLength(10)
    expect(s.request.browser!.generation).toBe(f.request.browser!.generation + 1)
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 4,
      required: true,
      setupComplete: false,
      codeGeneration: 1,
    })
    const factor = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    expect(factor.lastAcceptedStep).toBeGreaterThan(0n)
    expect(
      await db.$transaction((tx) => fixture.first.consumeLocked(tx, f.user.id, 4, proof))
    ).toBeNull()
    expect(
      await db.$transaction((tx) =>
        fixture.first.consumeLocked(tx, f.user.id, 4, {
          method: 'recovery_code',
          code: s.codes[0]!,
        })
      )
    ).toBeNull()
    expect(await db.$transaction((tx) => lockMfaFlow(tx, s.request))).not.toBeNull()
    expect(await f.binding.bind(f.request, operationId, proof, 'source')).toEqual({
      outcome: 'restart_required',
    })
    expect(await f.ack.acknowledge(s.request, randomUUID(), 2, 'source')).toEqual({
      outcome: 'generation_changed',
    })
    const ackId = randomUUID()
    expect(await f.ack.acknowledge(s.request, ackId, 1, 'source')).toEqual({
      outcome: 'acknowledged',
      generation: 1,
    })
    expect(await f.ack.acknowledge(s.request, ackId, 1, 'source')).toEqual({
      outcome: 'acknowledged',
      generation: 1,
    })
    expect(await db.session.count({ where: { revokedAt: null } })).toBe(0)
    expect(await db.mfaFactor.findUnique({ where: { userId: f.user.id } })).toEqual(factor)
    expect(
      await db.notification.count({
        where: { recipientUserId: f.user.id, type: 'account.mfa_factor_changed' },
      })
    ).toBe(1)
    expect(
      await db.auditLog.count({ where: { actorId: f.user.id, action: 'auth.mfa_setup_completed' } })
    ).toBe(1)
    const durable = JSON.stringify([
      await db.mfaFlow.findMany(),
      await db.mfaOperation.findMany(),
      await db.mfaRecoveryCode.findMany(),
      await db.notification.findMany(),
    ])
    for (const secret of [f.seed, s.request.credential, ...s.codes])
      expect(durable).not.toContain(secret)
  })

  it('commits malformed-code debt once and stops on the fifth failure without binding', async () => {
    const db = fixture.clients[0]!
    const f = await factorBindingFixture(fixture, hash, password)
    const operationId = randomUUID()
    expect(await f.binding.bind(f.request, operationId, { code: 'bad' }, 'source')).toEqual({
      outcome: 'wrong_code',
    })
    expect(await f.binding.bind(f.request, operationId, { code: 'bad' }, 'source')).toEqual({
      outcome: 'wrong_code',
    })
    for (let n = 0; n < 4; n++)
      await f.binding.bind(f.request, randomUUID(), { code: 'bad' }, 'source')
    expect(
      await f.binding.bind(f.request, randomUUID(), await seedProof(fixture, f.seed), 'source')
    ).toEqual({ outcome: 'restart_required' })
    expect(await db.mfaFactor.count()).toBe(0)
    expect(
      (await db.mfaAttemptBudget.findUniqueOrThrow({ where: { userId: f.user.id } })).failures
    ).toHaveLength(5)
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 3,
      setupComplete: false,
    })
  })

  it('rolls back factor, epoch, browser, codes and transfer when notification intent fails', async () => {
    const db = fixture.clients[0]!
    const f = await factorBindingFixture(fixture, hash, password)
    const before = await db.browserAuthContext.findUniqueOrThrow({
      where: { id: f.request.browser!.contextId },
    })
    const spy = jest
      .spyOn(f.effects.notifications, 'notifyTx')
      .mockRejectedValueOnce(new Error('intent unavailable'))
    await expect(
      f.binding.bind(f.request, randomUUID(), await seedProof(fixture, f.seed), 'source')
    ).rejects.toThrow('intent unavailable')
    spy.mockRestore()
    expect(await db.browserAuthContext.findUnique({ where: { id: before.id } })).toEqual(before)
    expect(await db.mfaFactor.count()).toBe(0)
    expect(await db.mfaRecoveryCode.count()).toBe(0)
    expect(await db.mfaOperation.count({ where: { kind: 'setup_transfer' } })).toBe(0)
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 3,
    })
    expect(await db.$transaction((tx) => lockMfaFlow(tx, f.request))).not.toBeNull()
  })

  it('requires an aged password again inside the same setup deadline', async () => {
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
    const flow = await db.mfaFlow.findUniqueOrThrow({ where: { id: s.flowId } })
    const data = flowData(flow.data)
    const proofs = data.proofs as { primary: { verifiedAt: string } }
    proofs.primary.verifiedAt = new Date(Date.now() - 700_000).toISOString()
    await db.mfaFlow.update({ where: { id: flow.id }, data: { data } })
    expect(await f.ack.acknowledge(s.request, randomUUID(), 1, 'source')).toEqual({
      outcome: 'proof_required',
      requiredProofs: ['password'],
    })
    const primary = new MfaPasswordVerificationService(
      db as unknown as PrismaService,
      f.login as never,
      f.source as never,
      f.effects.events
    )
    expect((await primary.submit(s.request, randomUUID(), password, 'source')).outcome).toBe(
      'verified'
    )
    expect(await f.ack.acknowledge(s.request, randomUUID(), 1, 'source')).toEqual({
      outcome: 'acknowledged',
      generation: 1,
    })
    expect(await db.mfaFlow.findUnique({ where: { id: flow.id } })).toMatchObject({
      expiresAt: flow.expiresAt,
    })
  })
})
