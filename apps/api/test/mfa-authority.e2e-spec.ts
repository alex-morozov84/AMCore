import { SystemRole } from '@amcore/shared'

import { advanceAccountSecurity } from '../src/core/auth/mfa/mfa-invalidation.js'
import { lockMfaAccounts } from '../src/core/auth/mfa/mfa-transaction.js'

import { authorityReader, createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Account epoch and primary admission on isolated PostgreSQL', () => {
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

  it('commits password, epoch and family/refresh/flow revocation together', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const reader = authorityReader(fixture.clients[1]!)
    expect(await reader.read(f.claims)).toEqual({ kind: 'admitted', operator: true })
    await db.$transaction(async (tx) => {
      await lockMfaAccounts(tx, [f.user.id])
      await tx.user.update({ where: { id: f.user.id }, data: { passwordHash: 'new-fixture-hash' } })
      expect(await advanceAccountSecurity(tx, f.user.id)).toBe(4)
    })
    expect(await reader.read(f.claims)).toEqual({ kind: 'denied', reason: 'session_changed' })
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      required: true,
      setupComplete: true,
      securityVersion: 4,
    })
    expect(await db.mfaFactor.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      lastAcceptedStep: 42n,
    })
    expect(await db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject({
      revokedAt: expect.any(Date),
    })
    expect(await db.session.findUnique({ where: { id: f.session.id } })).toMatchObject({
      revokedAt: expect.any(Date),
    })
    expect(await db.mfaFlow.findUnique({ where: { id: f.flow.id } })).toMatchObject({
      state: 'retired',
    })
  })

  it('rolls back the password and all authority effects if the security transaction fails', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    await expect(
      db.$transaction(async (tx) => {
        await lockMfaAccounts(tx, [f.user.id])
        await tx.user.update({
          where: { id: f.user.id },
          data: { passwordHash: 'never-committed' },
        })
        await advanceAccountSecurity(tx, f.user.id)
        throw new Error('enclosing security effect failed')
      })
    ).rejects.toThrow('enclosing security effect failed')
    expect(await authorityReader(fixture.clients[1]!).read(f.claims)).toEqual({
      kind: 'admitted',
      operator: true,
    })
    expect(await db.user.findUnique({ where: { id: f.user.id } })).toMatchObject({
      passwordHash: 'original-fixture-hash',
    })
    expect(await db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 3,
    })
    expect(await db.session.findUnique({ where: { id: f.session.id } })).toMatchObject({
      revokedAt: null,
    })
    expect(await db.mfaFlow.findUnique({ where: { id: f.flow.id } })).toMatchObject({
      state: 'open',
    })
  })

  it('denies ordinary browser credentials after reset while retaining independent ordinary JWT lifetime', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture, false)
    const reader = authorityReader(fixture.clients[1]!)
    expect((await reader.read(f.claims)).kind).toBe('admitted')
    await db.$transaction(async (tx) => {
      await lockMfaAccounts(tx, [f.user.id])
      await advanceAccountSecurity(tx, f.user.id)
    })
    expect((await reader.read(f.claims)).kind).toBe('denied')
    expect(
      await reader.read({ sub: f.user.id, email: f.user.email, systemRole: SystemRole.User })
    ).toEqual({ kind: 'admitted', operator: false })
    expect(await db.session.findUnique({ where: { id: f.session.id } })).toMatchObject({
      revokedAt: expect.any(Date),
    })
  })
})
