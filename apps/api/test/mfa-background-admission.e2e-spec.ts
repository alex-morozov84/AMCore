import { type RequestPrincipal } from '@amcore/shared'

import { BackgroundControlAuthority } from '../src/core/admin/background-control-authority.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { backgroundControlTransaction } from '../src/infrastructure/background-work/control-transaction.js'
import type { PrismaService } from '../src/prisma/index.js'

import { adminCommandFixture } from './mfa-admin-command.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Background-control admission uses the current family at each admission/dispatch fence', () => {
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

  async function admitted() {
    const actor = await adminCommandFixture(fixture)
    const db = fixture.clients[0]!
    const authority = new BackgroundControlAuthority(actor.env)
    return {
      ...actor,
      db,
      read: (fresh: boolean, principal: RequestPrincipal = actor.principal) =>
        backgroundControlTransaction(db as unknown as PrismaService, async (ctx) => {
          // A command's old sampled clock cannot preserve stale authentication after a lock wait.
          ctx.now = new Date(0)
          await authority.assert(ctx, principal, fresh)
        }),
    }
  }

  it('allows ordinary observation but requires only the stale second factor for command dispatch', async () => {
    const f = await admitted()
    const now = await mfaDatabaseClock(f.db)
    await f.db.authSessionFamily.update({
      where: { id: f.operator.family.id },
      data: {
        mfaAt: new Date(now.getTime() - 601_000),
      },
    })
    await expect(f.read(false)).resolves.toBeUndefined()
    await expect(f.read(true)).rejects.toMatchObject({
      errorCode: 'STEP_UP_REQUIRED',
      details: { requiredProofs: ['second_factor'] },
    })
  })

  it('rejects a family revoked after an earlier successful admission', async () => {
    const f = await admitted()
    await expect(f.read(true)).resolves.toBeUndefined()
    await f.db.authSessionFamily.update({
      where: { id: f.operator.family.id },
      data: {
        revokedAt: await mfaDatabaseClock(f.db),
      },
    })
    await expect(f.read(false)).rejects.toMatchObject({ errorCode: 'SESSION_CHANGED' })
    await expect(f.read(true)).rejects.toMatchObject({ errorCode: 'SESSION_CHANGED' })
  })

  it('uses committed MFA proofs rather than a legacy password timestamp and never renews them', async () => {
    const f = await admitted()
    await f.db.session.update({ where: { id: f.operator.session.id }, data: { lastAuthAt: null } })
    await expect(f.read(true)).resolves.toBeUndefined()
    expect(
      await f.db.authSessionFamily.findUnique({ where: { id: f.operator.family.id } })
    ).toEqual(f.operator.family)
  })

  it('keeps a current family admitted after its historical token row was rotated and removed', async () => {
    const f = await admitted()
    await f.db.session.create({
      data: {
        userId: f.operator.user.id,
        familyId: f.operator.family.id,
        refreshToken: `fake-next-token-${f.operator.user.id}`,
        expiresAt: f.operator.family.expiresAt,
      },
    })
    await f.db.session.delete({ where: { id: f.operator.session.id } })
    await expect(f.read(false)).resolves.toBeUndefined()
    await expect(f.read(true)).resolves.toBeUndefined()
  })

  it.each(['copied_browser', 'api_key'] as const)(
    'refuses %s without inherited browser or operator authority',
    async (kind) => {
      const f = await admitted()
      const principal: RequestPrincipal = {
        ...f.principal,
        type: kind === 'api_key' ? 'api_key' : 'jwt',
      }
      await expect(f.read(true, principal)).rejects.toMatchObject({
        errorCode: kind === 'api_key' ? 'FORBIDDEN' : 'SESSION_CHANGED',
      })
    }
  )
})
