import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { lockMfaFlow } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { MfaSessionFlowService } from '../src/core/auth/mfa/mfa-session-flow.service.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { EnvService } from '../src/env/env.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

/** Real signature and primary DB checks. No Authorization body fields or actor mock creates this flow. */
describe('Session flow creation captures the signed current family without a login transfer', () => {
  const fixture = new MfaProofFixture()
  const jwt = new JwtService({
    secret: '<fake-local-source-flow-signature-key-at-least-32>',
    signOptions: { expiresIn: '15m' },
  })
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

  async function prepared(window = 600) {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { primaryProofId: randomUUID(), mfaProofId: randomUUID() },
    })
    const family = await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    const service = new MfaSessionFlowService(
      db as unknown as PrismaService,
      jwt,
      {
        consume: async () => undefined,
      } as never,
      new EnvService(new ConfigService({ STEP_UP_MAX_AGE_SECONDS: window }))
    )
    return { ...f, family, service, token: jwt.sign(f.claims) }
  }

  it('captures original F evidence and current browser revision without advancing it', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const context = await db.browserAuthContext.findUniqueOrThrow({
      where: { id: f.requestBinding.contextId },
    })
    const result = await f.service.start(
      f.token,
      f.requestBinding,
      'rotate_codes',
      randomUUID(),
      'source'
    )
    if (result.kind !== 'flow') throw new Error('Expected session continuation')
    const locked = await db.$transaction((tx) => lockMfaFlow(tx, result.request))
    expect(locked?.source?.id).toBe(f.family.id)
    expect(locked?.flow.data).toMatchObject({
      proofs: {
        primary: {
          eventId: f.family.primaryProofId,
          verifiedAt: f.family.primaryAt!.toISOString(),
          origin: { kind: 'family', familyId: f.family.id },
        },
        secondFactor: {
          eventId: f.family.mfaProofId,
          verifiedAt: f.family.mfaAt!.toISOString(),
          origin: { kind: 'family', familyId: f.family.id },
        },
      },
    })
    expect(await db.browserAuthContext.findUnique({ where: { id: context.id } })).toEqual(context)
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(f.family)
    expect(await db.session.count()).toBe(1)
    expect(JSON.stringify(await db.mfaFlow.findMany())).not.toContain(result.request.credential)
  })

  it.each([
    [300, undefined, 300],
    [3600, undefined, 600],
    [300, 60, 60],
  ] as const)(
    'records configured/requested window %s/%s as %s seconds',
    async (configured, requested, expected) => {
      const f = await prepared(configured)
      const result = await f.service.start(
        f.token,
        f.requestBinding,
        'reauthenticate',
        randomUUID(),
        'source',
        requested
      )
      if (result.kind !== 'flow') throw new Error('Expected reauthentication continuation')
      expect(
        await fixture.clients[0]!.mfaFlow.findUnique({ where: { id: result.flowId } })
      ).toMatchObject({ data: { proofWindowSeconds: expected } })
    }
  )

  it('rejects invalid signatures, missing/wrong browser capability and a revoked source before mutation', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const bad = new JwtService({ secret: '<fake-other-source-flow-signing-key-at-least-32>' }).sign(
      f.claims
    )
    expect(
      await f.service.start(bad, f.requestBinding, 'reauthenticate', randomUUID(), 'source')
    ).toEqual({ kind: 'restart_required' })
    expect(await f.service.start(f.token, null, 'reauthenticate', randomUUID(), 'source')).toEqual({
      kind: 'restart_required',
    })
    expect(
      await f.service.start(
        f.token,
        { ...f.requestBinding, generation: 2 },
        'reauthenticate',
        randomUUID(),
        'source'
      )
    ).toEqual({ kind: 'restart_required' })
    await db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: await mfaDatabaseClock(db) },
    })
    expect(
      await f.service.start(f.token, f.requestBinding, 'replace_factor', randomUUID(), 'source')
    ).toEqual({ kind: 'restart_required' })
    expect(await db.mfaOperation.count()).toBe(0)
  })

  it('deduplicates no credentials and stops at three live flows without evicting them', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const operationId = randomUUID()
    expect(
      (await f.service.start(f.token, f.requestBinding, 'reauthenticate', operationId, 'source'))
        .kind
    ).toBe('flow')
    expect(
      await f.service.start(f.token, f.requestBinding, 'reauthenticate', operationId, 'source')
    ).toEqual({ kind: 'restart_required' })
    expect(
      (await f.service.start(f.token, f.requestBinding, 'replace_factor', randomUUID(), 'source'))
        .kind
    ).toBe('flow')
    expect(
      (await f.service.start(f.token, f.requestBinding, 'rotate_codes', randomUUID(), 'source'))
        .kind
    ).toBe('flow')
    expect(
      (await f.service.start(f.token, f.requestBinding, 'reauthenticate', randomUUID(), 'source'))
        .kind
    ).toBe('limited')
    expect(
      await db.mfaFlow.count({
        where: { browserContextId: f.requestBinding.contextId, state: 'open' },
      })
    ).toBe(3)
    expect(
      (await db.mfaAttemptBudget.findUniqueOrThrow({ where: { userId: f.user.id } })).starts
    ).toHaveLength(3)
  })
})
