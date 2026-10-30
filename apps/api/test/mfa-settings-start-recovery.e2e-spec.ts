import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'

import { MfaSessionFlowService } from '../src/core/auth/mfa/mfa-session-flow.service.js'
import { MfaSettingsStartRecoveryService } from '../src/core/auth/mfa/mfa-settings-start-recovery.service.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { EnvService } from '../src/env/env.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Settings-start receipts retain exact source authority on PostgreSQL', () => {
  const fixture = new MfaProofFixture()
  const jwt = new JwtService({
    secret: '<fake-settings-receipt-test-signing-key>',
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
  async function prepared() {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const source = db as unknown as PrismaService
    const start = new MfaSessionFlowService(
      source,
      jwt,
      { consume: async () => undefined } as never,
      new EnvService(new ConfigService({ STEP_UP_MAX_AGE_SECONDS: 600 }))
    )
    const recovery = new MfaSettingsStartRecoveryService(source, jwt)
    const input = {
      operationId: randomUUID(),
      purpose: 'rotate_codes' as const,
      startNotAfter: new Date((await mfaDatabaseClock(db)).getTime() + 25000).toISOString(),
    }
    const token = jwt.sign(f.claims)
    const dispatch = () =>
      start.start(
        token,
        f.requestBinding,
        input.purpose,
        input.operationId,
        'source',
        undefined,
        input
      )
    return { ...f, db, input, token, recovery, dispatch }
  }
  it('records once, returns no recovered credential, and retires only its unprogressed flow', async () => {
    const f = await prepared()
    const started = await f.dispatch()
    if (started.kind !== 'flow') throw new Error('Expected source flow')
    const before = await f.db.mfaFlow.count()
    const repeated = await f.dispatch()
    expect(repeated).toMatchObject({
      kind: 'recorded',
      status: { state: 'created', flowId: started.flowId },
    })
    expect(JSON.stringify(repeated)).not.toContain(started.request.credential)
    expect(await f.db.mfaFlow.count()).toBe(before)
    await expect(
      f.recovery.resolve(f.token, f.requestBinding, f.input, true)
    ).resolves.toMatchObject({ state: 'abandoned' })
    expect((await f.db.mfaFlow.findUniqueOrThrow({ where: { id: started.flowId } })).state).toBe(
      'retired'
    )
    expect((await f.db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })).state).toBe('open')
    expect(
      (await f.db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).revokedAt
    ).toBeNull()
  })
  it('tombstones an undispatched operation before a delayed start can create its flow', async () => {
    const f = await prepared()
    const before = await f.db.mfaFlow.count()
    await expect(
      f.recovery.resolve(f.token, f.requestBinding, f.input, true)
    ).resolves.toMatchObject({ state: 'abandoned' })
    await expect(f.dispatch()).resolves.toMatchObject({
      kind: 'recorded',
      status: { state: 'abandoned' },
    })
    expect(await f.db.mfaFlow.count()).toBe(before)
  })
  it('does not undo progressed operations or allow a changed source to resolve them', async () => {
    const f = await prepared()
    const started = await f.dispatch()
    if (started.kind !== 'flow') throw new Error('Expected source flow')
    await f.db.mfaOperation.create({
      data: {
        id: randomUUID(),
        flowId: started.flowId,
        kind: 'proof',
        result: { outcome: 'verified' },
      },
    })
    await expect(
      f.recovery.resolve(f.token, f.requestBinding, f.input, true)
    ).resolves.toMatchObject({ state: 'advanced_unrecoverable' })
    expect((await f.db.mfaFlow.findUniqueOrThrow({ where: { id: started.flowId } })).state).toBe(
      'open'
    )
    await expect(
      f.recovery.resolve(f.token, { ...f.requestBinding, generation: 2 }, f.input, true)
    ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
    await f.db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { revokedAt: await mfaDatabaseClock(f.db) },
    })
    await expect(
      f.recovery.resolve(f.token, f.requestBinding, f.input, false)
    ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
  })
})
