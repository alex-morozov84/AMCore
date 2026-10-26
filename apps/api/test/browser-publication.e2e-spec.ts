import { randomUUID } from 'node:crypto'

import type { BrowserRevision } from '@amcore/shared'

import {
  bootstrapBrowserContext,
  matchesBrowserRevision,
  readBrowserContext,
} from '../src/core/auth/mfa/browser-context.repository.js'
import {
  lockBrowserLogin,
  reserveBrowserLogin,
} from '../src/core/auth/mfa/browser-login-reservation.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'

import { authorityReader, createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

type BoundFixture = Awaited<ReturnType<typeof createAuthorityAccount>> & {
  binding: string
  expected: BrowserRevision
}

async function boundFixture(fixture: MfaProofFixture): Promise<BoundFixture> {
  const db = fixture.clients[0]!
  const f = await createAuthorityAccount(fixture)
  const bootstrap = await bootstrapBrowserContext(db, 'product')
  await db.authSessionFamily.update({
    where: { id: f.family.id },
    data: { browserContextId: bootstrap.view.contextId, publicationGeneration: 1 },
  })
  await db.browserAuthContext.update({
    where: { id: bootstrap.view.contextId },
    data: {
      state: 'published',
      generation: 1,
      currentFamilyId: f.family.id,
      expiresAt: f.family.expiresAt,
    },
  })
  return {
    ...f,
    binding: bootstrap.binding,
    expected: { contextId: bootstrap.view.contextId, generation: 1 },
  }
}

describe('Browser generation reservation on primary PostgreSQL', () => {
  const fixture = new MfaProofFixture()
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

  it('uses a fresh binding per bootstrap, stores only its hash and refuses wrong audience/expiry', async () => {
    const db = fixture.clients[0]!
    const first = await bootstrapBrowserContext(db, 'product')
    const second = await bootstrapBrowserContext(db, 'product')
    expect(first.binding === second.binding).toBe(false)
    const row = await readBrowserContext(db, first.binding, 'product')
    expect(row?.bindingHash === first.binding).toBe(false)
    expect(row?.id).toBe(first.view.contextId)
    expect(await readBrowserContext(db, first.binding, 'console')).toBeNull()
    expect(await readBrowserContext(db, 'malformed', 'product')).toBeNull()
    const now = await mfaDatabaseClock(db)
    expect(matchesBrowserRevision(row, first.view, now)).toBe(true)
    expect(matchesBrowserRevision(row && { ...row, expiresAt: now }, first.view, now)).toBe(false)
  })

  it('retires the old browser family but preserves an independently issued family', async () => {
    const db = fixture.clients[0]!
    const f = await boundFixture(fixture)
    const reader = authorityReader(fixture.clients[1]!)
    const independent = await db.authSessionFamily.create({
      data: { ...f.family, id: randomUUID(), browserContextId: null, publicationGeneration: null },
    })
    const other = await db.user.create({
      data: { email: 'other@example.test', emailCanonical: 'other@example.test' },
    })
    expect((await reader.read(f.claims)).kind).toBe('admitted')
    await db.$transaction(
      async (tx) => {
        const locked = await lockBrowserLogin(tx, f.binding, 'product', f.expected, other.id)
        if (!locked) throw new Error('fixture could not lock expected browser')
        const now = await mfaDatabaseClock(tx)
        const reserved = await reserveBrowserLogin(
          tx,
          locked,
          f.expected,
          randomUUID(),
          new Date(now.getTime() + 300_000)
        )
        expect(reserved?.generation).toBe(2)
      },
      { maxWait: 2000, timeout: 4000 }
    )
    expect(await reader.read(f.claims)).toEqual({
      kind: 'denied',
      reason: 'browser_context_changed',
    })
    expect(
      await reader.read({ ...f.claims, fid: independent.id, browserBound: undefined })
    ).toEqual({ kind: 'admitted', operator: true })
    expect(await db.session.findUnique({ where: { id: f.session.id } })).toMatchObject({
      revokedAt: expect.any(Date),
      revocationReason: 'browser-superseded',
    })
    const stale = await db.$transaction((tx) =>
      lockBrowserLogin(tx, f.binding, 'product', f.expected, other.id)
    )
    expect(stale).toBeNull()
    expect(
      (await db.browserAuthContext.findUnique({ where: { id: f.expected.contextId } }))?.generation
    ).toBe(2)
    expect(
      (await db.authSessionFamily.findUnique({ where: { id: independent.id } }))?.revokedAt
    ).toBeNull()
  })

  it('rolls reservation and old-family revocation back with the enclosing auth operation', async () => {
    const db = fixture.clients[0]!
    const f = await boundFixture(fixture)
    await expect(
      db.$transaction(async (tx) => {
        const locked = await lockBrowserLogin(tx, f.binding, 'product', f.expected, f.user.id)
        if (!locked) throw new Error('fixture could not lock expected browser')
        const now = await mfaDatabaseClock(tx)
        await reserveBrowserLogin(
          tx,
          locked,
          f.expected,
          randomUUID(),
          new Date(now.getTime() + 300_000)
        )
        throw new Error('new auth operation failed')
      })
    ).rejects.toThrow('new auth operation failed')
    expect(await authorityReader(fixture.clients[1]!).read(f.claims)).toEqual({
      kind: 'admitted',
      operator: true,
    })
    expect(
      (await db.browserAuthContext.findUnique({ where: { id: f.expected.contextId } }))?.generation
    ).toBe(1)
    expect((await db.session.findUnique({ where: { id: f.session.id } }))?.revokedAt).toBeNull()
  })
})
