import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import * as argon2 from 'argon2'

import { MfaSetupCodeRecoveryService } from '../src/core/auth/mfa/mfa-setup-code-recovery.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { factorBindingFixture, seedProof } from './mfa-factor-binding.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

const password = '<fake-isolated-lost-setup-codes-password>'

describe('Lost setup codes need a next unused app code, never backup-code replay', () => {
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
    const f = await factorBindingFixture(fixture, hash, password)
    const proof = await seedProof(fixture, f.seed)
    const bound = await f.binding.bind(f.request, randomUUID(), proof, 'source')
    if (bound.outcome !== 'bound') throw new Error('Expected setup')
    const service = new MfaSetupCodeRecoveryService(
      fixture.clients[0]! as unknown as PrismaService,
      fixture.first,
      f.source as never,
      f.effects.events
    )
    return { ...f, originalProof: proof, successor: bound.successor, recovery: service }
  }

  it('rejects the binding step, then replaces the lost set once using the next step', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const s = f.successor
    expect(await f.recovery.recover(s.request, randomUUID(), f.originalProof, 'source')).toEqual({
      outcome: 'wrong_code',
    })
    const operationId = randomUUID()
    const result = await f.recovery.recover(
      s.request,
      operationId,
      await seedProof(fixture, f.seed, 1),
      'source'
    )
    if (result.outcome !== 'codes') throw new Error('Expected replacement codes')
    expect(result.generation).toBe(2)
    expect(result.codes).toHaveLength(10)
    expect(
      await f.recovery.recover(s.request, operationId, { method: 'totp', code: 'bad' }, 'source')
    ).toEqual({ outcome: 'already_generated', generation: 2 })
    expect(await f.ack.acknowledge(s.request, randomUUID(), 1, 'source')).toEqual({
      outcome: 'generation_changed',
    })
    expect(await f.ack.acknowledge(s.request, randomUUID(), 2, 'source')).toEqual({
      outcome: 'acknowledged',
      generation: 2,
    })
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 4,
      setupComplete: true,
      codeGeneration: 2,
    })
    expect(await db.mfaFactor.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      version: 1,
    })
    expect(await db.mfaOperation.count({ where: { kind: 'setup_transfer' } })).toBe(1)
    const durable = JSON.stringify([
      await db.mfaFlow.findMany(),
      await db.mfaOperation.findMany(),
      await db.notification.findMany(),
    ])
    for (const value of result.codes) expect(durable).not.toContain(value)
    expect(
      await f.recovery.recover(
        s.request,
        randomUUID(),
        await seedProof(fixture, f.seed, 1),
        'source'
      )
    ).toEqual({ outcome: 'restart_required' })
  })

  it('never accepts or consumes an inactive backup code for setup recovery', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    expect(
      await f.recovery.recover(
        f.successor.request,
        randomUUID(),
        { method: 'recovery_code', code: f.successor.codes[0] },
        'source'
      )
    ).toEqual({ outcome: 'wrong_code' })
    expect(await db.mfaRecoveryCode.count({ where: { userId: f.user.id, consumedAt: null } })).toBe(
      10
    )
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      codeGeneration: 1,
      setupComplete: false,
    })
  })

  it('rolls back the next-step consumption and new generation when mandatory intent fails', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const before = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    const codes = await db.mfaRecoveryCode.findMany()
    const proof = await seedProof(fixture, f.seed, 1)
    const spy = jest
      .spyOn(f.effects.notifications, 'notifyTx')
      .mockRejectedValueOnce(new Error('intent unavailable'))
    await expect(
      f.recovery.recover(f.successor.request, randomUUID(), proof, 'source')
    ).rejects.toThrow('intent unavailable')
    spy.mockRestore()
    expect(await db.mfaFactor.findUnique({ where: { userId: f.user.id } })).toEqual(before)
    expect(await db.mfaRecoveryCode.findMany()).toEqual(codes)
    expect(
      (await f.recovery.recover(f.successor.request, randomUUID(), proof, 'source')).outcome
    ).toBe('codes')
  })
})
