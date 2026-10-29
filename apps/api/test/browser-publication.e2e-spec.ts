import { randomBytes } from 'node:crypto'

import { jest } from '@jest/globals'

import { BrowserPublicationService } from '../src/core/auth/mfa/browser-publication.service.js'
import type { MfaSourceLimiterService } from '../src/core/auth/mfa/mfa-source-limiter.service.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { hashRefreshToken } from '../src/core/auth/utils/refresh-token-hash.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Account-neutral browser bootstrap and read-only exact-vault proof on PostgreSQL', () => {
  const fixture = new MfaProofFixture()
  const consume = jest.fn<() => Promise<void>>()
  const service = (): BrowserPublicationService =>
    new BrowserPublicationService(
      fixture.clients[0]! as unknown as PrismaService,
      { consume } as unknown as MfaSourceLimiterService
    )
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    consume.mockReset().mockResolvedValue(undefined)
    const db = fixture.clients[0]!
    await db.user.deleteMany()
    await db.browserAuthContext.deleteMany()
    await db.mfaProtocol.upsert({
      where: { id: 'platform' },
      create: { id: 'platform', state: 'active' },
      update: { state: 'active', version: 1 },
    })
  })

  async function prepared(protectedAccount = true) {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture, protectedAccount)
    const raw = randomBytes(32).toString('hex')
    await db.session.update({
      where: { id: f.session.id },
      data: { refreshToken: hashRefreshToken(raw) },
    })
    return { ...f, input: { refreshToken: raw, familyId: f.family.id, securityVersion: 3 } }
  }

  it('creates distinct neutral anchors and never re-emits a previously issued binding', async () => {
    const s = service()
    const first = await s.bootstrap('product', undefined, 'source')
    if (first.kind !== 'created') throw new Error('Expected new anchor')
    expect(Object.keys(first).sort()).toEqual(['binding', 'kind', 'view'])
    await expect(s.bootstrap('product', first.binding, 'source')).resolves.toEqual({
      kind: 'existing',
      view: first.view,
    })
    await expect(s.status('product', first.binding)).resolves.toEqual(first.view)
    expect(consume).toHaveBeenCalledTimes(1)
    const retry = await s.bootstrap('product', undefined, 'source')
    if (retry.kind !== 'created') throw new Error('Expected distinct retry')
    expect(retry.binding === first.binding).toBe(false)
    expect(retry.view.contextId === first.view.contextId).toBe(false)
    expect(await fixture.clients[0]!.session.count()).toBe(0)
    expect(await fixture.clients[0]!.user.count()).toBe(0)
  })

  it('returns only primary tuple metadata without token rotation, proof renewal or session writes', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    const session = await db.session.findUniqueOrThrow({ where: { id: f.session.id } })
    const context = await db.browserAuthContext.findUniqueOrThrow({
      where: { id: f.requestBinding.contextId },
    })
    await expect(service().probe(f.input, f.requestBinding)).resolves.toEqual({
      status: 'current',
      userId: f.user.id,
      familyId: f.family.id,
      securityVersion: 3,
      contextId: context.id,
      generation: 1,
      audience: 'product',
    })
    expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session)
    expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
      f.family
    )
    expect(await db.browserAuthContext.findUniqueOrThrow({ where: { id: context.id } })).toEqual(
      context
    )
    expect(consume).not.toHaveBeenCalled()
  })

  it('uses a retained rotated row only for identity, and refuses other revoked refresh credentials', async () => {
    const db = fixture.clients[0]!
    const f = await prepared()
    await db.session.update({
      where: { id: f.session.id },
      data: { revokedAt: new Date(), revocationReason: 'rotated' },
    })
    await expect(service().probe(f.input, f.requestBinding)).resolves.toMatchObject({
      status: 'current',
    })
    await db.session.update({
      where: { id: f.session.id },
      data: { revocationReason: 'user-revoked' },
    })
    await expect(service().probe(f.input, f.requestBinding)).rejects.toMatchObject({
      status: 401,
      errorCode: 'AUTH_CONTEXT_CHANGED',
    })
    expect(
      (await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).revokedAt
    ).toBeNull()
  })

  it('refuses absent/mismatched capability, tuple, epoch or audience instead of selecting current account', async () => {
    const f = await prepared()
    const s = service()
    for (const binding of [
      null,
      { ...f.requestBinding, bindingHash: '0'.repeat(64) },
      { ...f.requestBinding, generation: 2 },
      { ...f.requestBinding, audience: 'console' as const },
    ])
      await expect(s.probe(f.input, binding)).rejects.toMatchObject({
        status: 401,
        errorCode: 'AUTH_CONTEXT_CHANGED',
      })
    for (const patch of [{ familyId: 'another-family' }, { securityVersion: 4 }])
      await expect(s.probe({ ...f.input, ...patch }, f.requestBinding)).rejects.toMatchObject({
        status: 401,
        errorCode: 'AUTH_CONTEXT_CHANGED',
      })
  })

  it.each([
    'pending',
    'revoked',
    'account_version',
    'generation',
    'expired_refresh',
    'missing_family',
  ])('refuses current primary state %s', async (state) => {
    const db = fixture.clients[0]!
    const f = await prepared()
    if (state === 'missing_family')
      await db.authSessionFamily.delete({ where: { id: f.family.id } })
    if (state === 'pending')
      await db.authSessionFamily.update({
        where: { id: f.family.id },
        data: { publicationState: 'pending' },
      })
    if (state === 'revoked')
      await db.authSessionFamily.update({
        where: { id: f.family.id },
        data: { revokedAt: new Date() },
      })
    if (state === 'account_version')
      await db.mfaAccount.update({ where: { userId: f.user.id }, data: { securityVersion: 4 } })
    if (state === 'generation')
      await db.browserAuthContext.update({
        where: { id: f.requestBinding.contextId },
        data: { generation: 2 },
      })
    if (state === 'expired_refresh')
      await db.session.update({
        where: { id: f.session.id },
        data: { expiresAt: new Date((await mfaDatabaseClock(db)).getTime() - 1) },
      })
    await expect(service().probe(f.input, f.requestBinding)).rejects.toMatchObject({
      status: 401,
      errorCode: 'AUTH_CONTEXT_CHANGED',
    })
  })

  it('keeps ordinary prepared browser admission, but never grants an enrolled operator through prepared mode', async () => {
    const db = fixture.clients[0]!
    const ordinary = await prepared(false)
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'prepared' } })
    await expect(service().probe(ordinary.input, ordinary.requestBinding)).resolves.toMatchObject({
      status: 'current',
      userId: ordinary.user.id,
    })
    await db.user.deleteMany()
    const operator = await prepared()
    await expect(service().probe(operator.input, operator.requestBinding)).rejects.toMatchObject({
      status: 503,
    })
  })

  it('refuses expired status and renews only neutral state at the same known binding on bootstrap', async () => {
    const db = fixture.clients[0]!
    const first = await service().bootstrap('product', undefined, 'source')
    if (first.kind !== 'created') throw new Error('Expected bootstrap')
    await db.browserAuthContext.update({
      where: { id: first.view.contextId },
      data: { expiresAt: new Date((await mfaDatabaseClock(db)).getTime() - 1) },
    })
    await expect(service().status('product', first.binding)).rejects.toMatchObject({
      errorCode: 'AUTH_CONTEXT_CHANGED',
    })
    const next = await service().bootstrap('product', first.binding, 'source')
    expect(next).toMatchObject({
      kind: 'existing',
      view: {
        contextId: first.view.contextId,
        generation: first.view.generation + 1,
        state: 'logged_out',
      },
    })
    expect('binding' in next).toBe(false)
    expect(await db.session.count()).toBe(0)
  })
})
