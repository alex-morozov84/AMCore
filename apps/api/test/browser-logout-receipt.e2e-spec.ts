import { randomUUID } from 'node:crypto'

import * as argon2 from 'argon2'

import { BrowserLogoutReceiptService } from '../src/core/auth/mfa/browser-logout-receipt.service.js'
import { linkReturnReservation } from '../src/core/auth/mfa/browser-return-transition.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { hashRefreshToken } from '../src/core/auth/utils/refresh-token-hash.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { loginStartFixture } from './mfa-login-start.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Exact logout receipt and presentation-only return chain on PostgreSQL', () => {
  const fixture = new MfaProofFixture()
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    await fixture.clients[0]!.user.deleteMany()
    await fixture.clients[0]!.browserAuthContext.deleteMany()
  })
  async function prepared() {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const refreshToken = mfaCredential()
    await db.session.update({
      where: { id: f.session.id },
      data: { refreshToken: hashRefreshToken(refreshToken) },
    })
    const input = {
      operationId: randomUUID(),
      returnEntryId: randomUUID(),
      receiptSecret: mfaCredential(),
      refreshToken,
      expiresAt: new Date((await mfaDatabaseClock(db)).getTime() + 800000).toISOString(),
    }
    return {
      ...f,
      db,
      input,
      service: new BrowserLogoutReceiptService(db as unknown as PrismaService),
    }
  }
  it('recovers only its own committed logout after response loss and never increments twice', async () => {
    const f = await prepared()
    await expect(f.service.resolve(f.requestBinding, f.input, f.input)).resolves.toMatchObject({
      state: 'logged_out',
      beforeGeneration: 1,
      afterGeneration: 2,
    })
    await expect(f.service.resolve(f.requestBinding, f.input, f.input)).resolves.toMatchObject({
      state: 'logged_out',
      afterGeneration: 2,
    })
    expect(
      (
        await f.db.browserAuthContext.findUniqueOrThrow({
          where: { id: f.requestBinding.contextId },
        })
      ).generation
    ).toBe(2)
    expect(
      (await f.db.session.findUniqueOrThrow({ where: { id: f.session.id } })).revokedAt
    ).not.toBeNull()
    await expect(
      f.service.resolve(f.requestBinding, { ...f.input, receiptSecret: mfaCredential() })
    ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
    await expect(
      f.service.resolve({ ...f.requestBinding, audience: 'console' }, f.input)
    ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
  })
  it('claims only the exact logout revision and strips its secret before storing the return join', async () => {
    const f = await prepared()
    await f.service.resolve(f.requestBinding, f.input, f.input)
    const proof = {
      operationId: f.input.operationId,
      returnEntryId: f.input.returnEntryId,
      receiptSecret: f.input.receiptSecret,
      neutralAttemptId: randomUUID(),
    }
    const loggedOut = { ...f.requestBinding, generation: 2 }
    await expect(f.service.resolve(loggedOut, f.input, undefined, proof)).resolves.toMatchObject({
      state: 'claimed',
      neutralAttemptId: proof.neutralAttemptId,
    })
    await expect(
      f.service.resolve(loggedOut, f.input, undefined, { ...proof, neutralAttemptId: randomUUID() })
    ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
    const reservedFlowId = randomUUID()
    const after = await f.db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { generation: 3, state: 'reserved', reservedFlowId },
    })
    const link = await f.db.$transaction((tx) =>
      linkReturnReservation(tx, proof, loggedOut, after, reservedFlowId, f.user.id, 3)
    )
    expect(link).toEqual({
      operationId: proof.operationId,
      returnEntryId: proof.returnEntryId,
      neutralAttemptId: proof.neutralAttemptId,
    })
    expect(JSON.stringify(link)).not.toContain(proof.receiptSecret)
    const receipt = await f.db.browserLogoutReceipt.findUniqueOrThrow({
      where: { operationId: proof.operationId },
    })
    expect(receipt).toMatchObject({ reservedFlowId, reservedGeneration: 3 })
    expect(receipt.credentialHash).not.toBe(proof.receiptSecret)
  })
  it('cannot turn a receipt into retirement or a claim for a later winning context', async () => {
    const f = await prepared()
    await f.service.resolve(f.requestBinding, f.input, f.input)
    const later = await f.db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { generation: 7, state: 'empty' },
    })
    await expect(f.service.resolve(f.requestBinding, f.input, f.input)).resolves.toMatchObject({
      state: 'superseded',
    })
    await expect(
      f.service.resolve({ ...f.requestBinding, generation: 2 }, f.input, undefined, {
        ...f.input,
        neutralAttemptId: randomUUID(),
      })
    ).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_CHANGED' })
    expect(await f.db.browserAuthContext.findUniqueOrThrow({ where: { id: later.id } })).toEqual(
      later
    )
  })
  it('rejects delayed original logout after a fresh credential reservation without a receipt', async () => {
    const f = await prepared()
    await f.db.mfaProtocol.upsert({
      where: { id: 'platform' },
      create: { id: 'platform', state: 'active' },
      update: { state: 'active', version: 1 },
    })
    await expect(f.service.resolve(f.requestBinding, f.input)).resolves.toMatchObject({
      state: 'not_found',
    })
    await f.db.user.update({
      where: { id: f.user.id },
      data: { email: 'original@example.test', emailCanonical: 'original@example.test' },
    })
    const password = '<fake-new-entry-password>'
    const login = await loginStartFixture(fixture, await argon2.hash(password))
    const reserved = await login.service.password(
      login.user.email,
      password,
      'source',
      { kind: 'browser', binding: f.requestBinding },
      randomUUID()
    )
    expect(reserved.kind).toBe('mfa')
    const before = await f.db.browserAuthContext.findUniqueOrThrow({
      where: { id: f.requestBinding.contextId },
    })
    expect(before).toMatchObject({ generation: 2, state: 'reserved' })
    await expect(f.service.resolve(f.requestBinding, f.input, f.input)).rejects.toMatchObject({
      errorCode: 'SESSION_CHANGED',
    })
    expect(await f.db.browserAuthContext.findUniqueOrThrow({ where: { id: before.id } })).toEqual(
      before
    )
    expect(
      await f.db.browserLogoutReceipt.count({ where: { operationId: f.input.operationId } })
    ).toBe(0)
    expect(
      await f.db.mfaFlow.count({
        where: { browserContextId: before.id, publicationGeneration: 2, state: 'open' },
      })
    ).toBe(1)
  })
})
