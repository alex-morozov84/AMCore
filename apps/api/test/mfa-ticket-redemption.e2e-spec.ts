import { randomUUID } from 'node:crypto'

import { jest } from '@jest/globals'
import * as argon2 from 'argon2'

import { lockMfaFlow } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'

import { seedProof } from './mfa-factor-binding.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'
import { ticketRedemptionFixture } from './mfa-ticket-redemption.fixture.js'

const password = '<fake-local-ticket-redemption-password>'
describe('One-use deployment ticket grants only exact fresh-password enrollment authority', () => {
  const fixture = new MfaProofFixture()
  let hash: string
  beforeAll(async () => {
    hash = await argon2.hash(password)
    await fixture.start()
  }, 120000)
  afterAll(() => fixture.close(), 60000)
  afterEach(() => jest.restoreAllMocks())
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

  it.each([false, true])(
    'creates only a restricted successor and requires new app/code saving (direct=%s)',
    async (direct) => {
      const db = fixture.clients[0]!
      const f = await ticketRedemptionFixture(fixture, hash, password, direct)
      await expect(f.drafts.open(f.start.request, randomUUID(), false, 'source')).resolves.toEqual({
        outcome: 'restart_required',
      })
      const operationId = randomUUID()
      const redeemed = await f.redemption.redeem(
        f.start.request,
        operationId,
        password,
        f.issued.ticket,
        'source'
      )
      if (redeemed.outcome !== 'enrollment') throw new Error('Expected restricted enrollment')
      expect(redeemed.request.credential === f.start.request.credential).toBe(false)
      expect(redeemed.expiresAt.getTime()).toBeLessThanOrEqual(f.issued.expiresAt.getTime())
      expect(await db.session.count({ where: { userId: f.user.id, revokedAt: null } })).toBe(0)
      expect(
        (await db.mfaAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).emergencyRequired
      ).toBe(true)
      expect(
        (await db.mfaRecoveryTicket.findUniqueOrThrow({ where: { userId: f.user.id } })).consumedAt
      ).not.toBeNull()
      await expect(
        f.redemption.redeem(f.start.request, operationId, password, f.issued.ticket, 'source')
      ).resolves.toEqual({ outcome: 'restart_required' })
      const draft = await f.drafts.open(redeemed.request, randomUUID(), false, 'source')
      if (draft.outcome !== 'seed') throw new Error('Expected new seed')
      const bound = await f.binding.bind(
        redeemed.request,
        randomUUID(),
        await seedProof(fixture, draft.secret),
        'source'
      )
      if (bound.outcome !== 'bound') throw new Error('Expected binding')
      expect(await db.mfaAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).toMatchObject(
        { securityVersion: 5, emergencyRequired: false, required: true, setupComplete: false }
      )
      await expect(
        f.ack.acknowledge(
          bound.successor.request,
          randomUUID(),
          bound.successor.generation,
          'source'
        )
      ).resolves.toMatchObject({ outcome: 'acknowledged' })
      expect(
        (await db.mfaAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).setupComplete
      ).toBe(true)
      expect(await db.session.count({ where: { userId: f.user.id, revokedAt: null } })).toBe(0)
      const durable = JSON.stringify({
        flows: await db.mfaFlow.findMany(),
        operations: await db.mfaOperation.findMany(),
        tickets: await db.mfaRecoveryTicket.findMany(),
      })
      expect(
        durable.includes(f.issued.ticket) ||
          durable.includes(redeemed.request.credential) ||
          durable.includes(draft.secret)
      ).toBe(false)
    }
  )

  it('commits one wrong-ticket debt per operation and refuses the fifth-failure flow', async () => {
    const db = fixture.clients[0]!
    const f = await ticketRedemptionFixture(fixture, hash, password)
    const operationId = randomUUID()
    for (let i = 0; i < 2; i++)
      await expect(
        f.redemption.redeem(f.start.request, operationId, password, mfaCredential(), 'source')
      ).resolves.toEqual({ outcome: 'wrong_ticket' })
    expect(
      (await db.mfaAttemptBudget.findUniqueOrThrow({ where: { userId: f.user.id } })).failures
    ).toHaveLength(1)
    for (let i = 0; i < 4; i++)
      await f.redemption.redeem(f.start.request, randomUUID(), password, mfaCredential(), 'source')
    await expect(
      f.redemption.redeem(f.start.request, randomUUID(), password, f.issued.ticket, 'source')
    ).resolves.toEqual({ outcome: 'restart_required' })
    expect(
      (await db.mfaRecoveryTicket.findUniqueOrThrow({ where: { userId: f.user.id } })).consumedAt
    ).toBeNull()
  })

  it('keeps password debt separate and does not consume a ticket on wrong password', async () => {
    const db = fixture.clients[0]!
    const f = await ticketRedemptionFixture(fixture, hash, password)
    await expect(
      f.redemption.redeem(
        f.start.request,
        randomUUID(),
        '<fake-wrong-password>',
        f.issued.ticket,
        'source'
      )
    ).resolves.toEqual({ outcome: 'wrong_password' })
    expect(f.login.consume).toHaveBeenCalled()
    expect(
      (await db.mfaRecoveryTicket.findUniqueOrThrow({ where: { userId: f.user.id } })).consumedAt
    ).toBeNull()
    expect(await db.mfaAttemptBudget.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      failures: [],
    })
  })

  it.each(['epoch', 'password_hash', 'browser_generation'])(
    'refuses %s changed during real password work',
    async (change) => {
      const db = fixture.clients[0]!
      const f = await ticketRedemptionFixture(fixture, hash, password)
      f.login.reset.mockImplementationOnce(async () => {
        if (change === 'epoch')
          await db.mfaAccount.update({ where: { userId: f.user.id }, data: { securityVersion: 5 } })
        if (change === 'password_hash')
          await db.user.update({ where: { id: f.user.id }, data: { passwordHash: 'changed hash' } })
        if (change === 'browser_generation')
          await db.browserAuthContext.update({
            where: { id: f.start.request.browser!.contextId },
            data: { generation: { increment: 1 } },
          })
      })
      await expect(
        f.redemption.redeem(f.start.request, randomUUID(), password, f.issued.ticket, 'source')
      ).resolves.toEqual({ outcome: 'restart_required' })
      expect(
        (await db.mfaRecoveryTicket.findUniqueOrThrow({ where: { userId: f.user.id } })).consumedAt
      ).toBeNull()
    }
  )

  it('rolls back ticket consumption/successor/browser when strict audit fails', async () => {
    const db = fixture.clients[0]!
    const f = await ticketRedemptionFixture(fixture, hash, password)
    const before = await db.browserAuthContext.findUniqueOrThrow({
      where: { id: f.start.request.browser!.contextId },
    })
    jest
      .spyOn(f.effects.events, 'ticketRedeemed')
      .mockRejectedValueOnce(new Error('audit unavailable'))
    await expect(
      f.redemption.redeem(f.start.request, randomUUID(), password, f.issued.ticket, 'source')
    ).rejects.toThrow('audit unavailable')
    expect(
      (await db.mfaRecoveryTicket.findUniqueOrThrow({ where: { userId: f.user.id } })).consumedAt
    ).toBeNull()
    expect(await db.browserAuthContext.findUniqueOrThrow({ where: { id: before.id } })).toEqual(
      before
    )
    expect(
      (await db.$transaction((tx) => lockMfaFlow(tx, f.start.request, { recoveryPending: true })))
        ?.flow.authorityKind
    ).toBe('recovery_pending')
  })

  it('refuses an expired or already used ticket without granting setup', async () => {
    const db = fixture.clients[0]!
    const f = await ticketRedemptionFixture(fixture, hash, password)
    await db.mfaRecoveryTicket.update({
      where: { userId: f.user.id },
      data: { expiresAt: new Date((await mfaDatabaseClock(db)).getTime() - 1) },
    })
    await expect(
      f.redemption.redeem(f.start.request, randomUUID(), password, f.issued.ticket, 'source')
    ).resolves.toEqual({ outcome: 'wrong_ticket' })
    await expect(f.drafts.open(f.start.request, randomUUID(), false, 'source')).resolves.toEqual({
      outcome: 'restart_required',
    })
  })
})
