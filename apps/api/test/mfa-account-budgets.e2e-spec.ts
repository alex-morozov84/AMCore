import { randomUUID } from 'node:crypto'

import {
  chargeFlowStart,
  readFailureBudget,
  recordFactorFailure,
} from '../src/core/auth/mfa/mfa-account-budgets.js'
import { liveMfaFlows } from '../src/core/auth/mfa/mfa-live-flows.js'
import { lockMfaAccounts } from '../src/core/auth/mfa/mfa-transaction.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'
import { pendingPublication } from './mfa-publication.fixture.js'

describe('MFA account budgets commit across independent database clients', () => {
  const fixture = new MfaProofFixture()
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    await fixture.clients[0]!.user.deleteMany()
    await fixture.clients[0]!.browserAuthContext.deleteMany()
  })

  it('commits negative outcomes, exhausts each flow and shares ten failures across flows', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const other = await db.mfaFlow.create({
      data: {
        ...f.flow,
        data: {},
        id: undefined,
        credentialHash: randomUUID(),
      },
    })
    for (let attempt = 0; attempt < 10; attempt++) {
      const client = fixture.clients[attempt % 2]!
      const outcome = await client.$transaction(async (tx) => {
        const now = await lockMfaAccounts(tx, [f.user.id])
        const budget = await readFailureBudget(tx, f.user.id, now)
        if (!budget.allowed) return 'limited'
        await recordFactorFailure(tx, attempt < 5 ? f.flow.id : other.id, f.user.id, budget, now)
        return 'wrong_code'
      })
      expect(outcome).toBe('wrong_code')
    }
    for (const id of [f.flow.id, other.id]) {
      expect(await db.mfaFlow.findUnique({ where: { id } })).toMatchObject({
        attempts: 5,
        state: 'attempts_exhausted',
      })
    }
    const budget = await fixture.clients[1]!.$transaction(async (tx) => {
      const now = await lockMfaAccounts(tx, [f.user.id])
      return readFailureBudget(tx, f.user.id, now)
    })
    expect(budget).toMatchObject({ allowed: false })
    expect(budget.retryAfter).toBeGreaterThan(0)
    expect(
      (await db.mfaAttemptBudget.findUniqueOrThrow({ where: { userId: f.user.id } })).failures
    ).toHaveLength(10)
  })

  it('rolls back all charges with an enclosing failure instead of reporting a committed negative', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    await expect(
      db.$transaction(async (tx) => {
        const now = await lockMfaAccounts(tx, [f.user.id])
        await recordFactorFailure(
          tx,
          f.flow.id,
          f.user.id,
          await readFailureBudget(tx, f.user.id, now),
          now
        )
        throw new Error('enclosing effect failed')
      })
    ).rejects.toThrow('enclosing effect failed')
    expect(await db.mfaAttemptBudget.findUnique({ where: { userId: f.user.id } })).toBeNull()
    expect(await db.mfaFlow.findUnique({ where: { id: f.flow.id } })).toMatchObject({
      attempts: 0,
      state: 'open',
    })
  })

  it('serializes concurrent starts and refuses excess without evicting live flows', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const independent = {
      authorityKind: 'identity',
      purpose: 'login',
      sourceFamilyId: null,
      sourceSecurityVersion: null,
    }
    await db.mfaFlow.update({ where: { id: f.flow.id }, data: independent })
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        fixture.clients[index % 2]!.$transaction(
          async (tx) => {
            const now = await lockMfaAccounts(tx, [f.user.id])
            return chargeFlowStart(tx, f.user.id, now)
          },
          { maxWait: 2000, timeout: 4000 }
        )
      )
    )
    expect(results.filter((result) => result.allowed)).toHaveLength(5)
    expect(results.filter((result) => !result.allowed)).toHaveLength(1)
    await db.mfaAttemptBudget.delete({ where: { userId: f.user.id } })
    for (let i = 0; i < 2; i++) {
      await db.mfaFlow.create({
        data: { ...f.flow, ...independent, data: {}, id: undefined, credentialHash: randomUUID() },
      })
    }
    const capped = await db.$transaction(async (tx) => {
      const now = await lockMfaAccounts(tx, [f.user.id])
      return chargeFlowStart(tx, f.user.id, now)
    })
    expect(capped.allowed).toBe(false)
    expect(await db.mfaFlow.count({ where: { userId: f.user.id, state: 'open' } })).toBe(3)
    expect(await db.mfaAttemptBudget.findUnique({ where: { userId: f.user.id } })).toBeNull()
  })

  it('does not count a revoked source family or a superseded browser generation as a live flow', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: {
        browserContextId: f.requestBinding.contextId,
        publicationGeneration: 1,
      },
    })
    const inspect = () =>
      db.$transaction(async (tx) => {
        const now = await lockMfaAccounts(tx, [f.user.id])
        return liveMfaFlows(tx, f.user.id, now)
      })
    expect(await inspect()).toHaveLength(1)
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: new Date() },
    })
    expect(await inspect()).toHaveLength(0)
    await db.authSessionFamily.update({ where: { id: f.family.id }, data: { revokedAt: null } })
    await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { generation: 2 },
    })
    expect(await inspect()).toHaveLength(0)
    expect(await db.mfaFlow.findUnique({ where: { id: f.flow.id } })).toMatchObject({
      state: 'open',
    })
  })

  it('counts a still-pending receipt after the human proof deadline and ignores it immediately after receipt expiry', async () => {
    const db = fixture.clients[0]!
    const f = await pendingPublication(fixture)
    await db.mfaFlow.update({ where: { id: f.flow.id }, data: { expiresAt: new Date(0) } })
    const inspect = () =>
      db.$transaction(async (tx) => {
        const now = await lockMfaAccounts(tx, [f.user.id])
        return liveMfaFlows(tx, f.user.id, now)
      })
    expect(await inspect()).toHaveLength(1)
    for (let i = 0; i < 2; i++)
      await db.mfaFlow.create({
        data: {
          userId: f.user.id,
          purpose: 'login',
          authorityKind: 'identity',
          audience: 'direct',
          bindingHash: 'fixture',
          credentialHash: randomUUID(),
          securityVersion: 3,
          expiresAt: f.family.expiresAt,
        },
      })
    expect(await inspect()).toHaveLength(3)
    const capped = await db.$transaction(async (tx) => {
      const now = await lockMfaAccounts(tx, [f.user.id])
      return chargeFlowStart(tx, f.user.id, now)
    })
    expect(capped.allowed).toBe(false)
    // Only an already-locked independent replacement can exclude its own current browser scope.
    const replacing = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.browser_auth_contexts WHERE id = ${f.requestBinding.contextId} FOR UPDATE`
      const now = await lockMfaAccounts(tx, [f.user.id])
      return chargeFlowStart(tx, f.user.id, now, f.requestBinding)
    })
    expect(replacing.allowed).toBe(true)
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { publicationDeadline: new Date(0) },
    })
    expect(await inspect()).toHaveLength(2)
  })
})
