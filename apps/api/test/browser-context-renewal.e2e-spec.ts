import { jest } from '@jest/globals'

import { hashBrowserBinding } from '../src/core/auth/mfa/browser-binding.js'
import { BrowserPublicationService } from '../src/core/auth/mfa/browser-publication.service.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import type { MfaSourceLimiterService } from '../src/core/auth/mfa/mfa-source-limiter.service.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Known expired browser binding renewal on PostgreSQL', () => {
  const fixture = new MfaProofFixture()
  const consume = jest.fn<() => Promise<void>>()
  const service = (index = 0): BrowserPublicationService =>
    new BrowserPublicationService(
      fixture.clients[index]! as unknown as PrismaService,
      { consume } as unknown as MfaSourceLimiterService
    )
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    consume.mockReset().mockResolvedValue(undefined)
    await fixture.clients[0]!.user.deleteMany()
    await fixture.clients[0]!.browserAuthContext.deleteMany()
  })

  async function expired() {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const binding = mfaCredential()
    const now = await mfaDatabaseClock(db)
    await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { bindingHash: hashBrowserBinding(binding)!, expiresAt: new Date(now.getTime() - 1) },
    })
    await db.mfaFlow.update({
      where: { id: f.flow.id },
      data: {
        browserContextId: f.requestBinding.contextId,
        publicationGeneration: 1,
        bindingHash: hashBrowserBinding(binding)!,
      },
    })
    return { ...f, binding }
  }

  it('serializes simultaneous renewals, preserves the binding and retires old authority once', async () => {
    const f = await expired()
    const db = fixture.clients[0]!
    const factor = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    const account = await db.mfaAccount.findUniqueOrThrow({ where: { userId: f.user.id } })
    const replies = await Promise.all([
      service().bootstrap('product', f.binding, 'source'),
      service(1).bootstrap('product', f.binding, 'source'),
    ])
    for (const reply of replies)
      expect(reply).toMatchObject({
        kind: 'existing',
        view: {
          contextId: f.requestBinding.contextId,
          generation: 2,
          state: 'logged_out',
        },
      })
    const renewed = await db.browserAuthContext.findUniqueOrThrow({
      where: { id: f.requestBinding.contextId },
    })
    expect(renewed).toMatchObject({
      bindingHash: hashBrowserBinding(f.binding),
      generation: 2,
      currentFamilyId: null,
      reservedFlowId: null,
      stagedBindingHash: null,
    })
    expect(renewed.expiresAt.getTime()).toBeGreaterThan((await mfaDatabaseClock(db)).getTime())
    expect(await db.browserAuthContext.count()).toBe(1)
    expect(
      await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })
    ).toMatchObject({ publicationState: 'retired', revokedAt: expect.any(Date) })
    expect(await db.session.findUniqueOrThrow({ where: { id: f.session.id } })).toMatchObject({
      revokedAt: expect.any(Date),
    })
    expect(await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })).toMatchObject({
      state: 'retired',
    })
    expect(await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })).toEqual(factor)
    expect(await db.mfaAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).toEqual(account)
    expect(await db.session.count()).toBe(1)
    expect(replies.every((reply) => !('binding' in reply))).toBe(true)
  })

  it('refuses participant mismatch without partly extending expiry or revoking sessions', async () => {
    const f = await expired()
    const db = fixture.clients[0]!
    const other = await createAuthorityAccount(fixture, false, 'other.renewal@example.test')
    const original = await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { currentFamilyId: other.family.id },
    })
    await expect(service().bootstrap('product', f.binding, 'source')).rejects.toMatchObject({
      status: 401,
      errorCode: 'AUTH_CONTEXT_CHANGED',
    })
    expect(await db.browserAuthContext.findUniqueOrThrow({ where: { id: original.id } })).toEqual(
      original
    )
    expect(
      (await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).revokedAt
    ).toBeNull()
    expect(
      (await db.session.findUniqueOrThrow({ where: { id: f.session.id } })).revokedAt
    ).toBeNull()
  })

  it('refuses an exhausted generation and a source refusal without changing expired authority', async () => {
    const f = await expired()
    const db = fixture.clients[0]!
    const original = await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { generation: 2147483647 },
    })
    await expect(service().bootstrap('product', f.binding, 'source')).rejects.toMatchObject({
      status: 401,
    })
    consume.mockRejectedValueOnce(new Error('Source unavailable'))
    await expect(service().bootstrap('product', f.binding, 'source')).rejects.toThrow(
      'Source unavailable'
    )
    expect(await db.browserAuthContext.findUniqueOrThrow({ where: { id: original.id } })).toEqual(
      original
    )
    expect(
      (await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).revokedAt
    ).toBeNull()
  })
})
