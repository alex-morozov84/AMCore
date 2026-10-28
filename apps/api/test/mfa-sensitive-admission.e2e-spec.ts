import { ConfigService } from '@nestjs/config'

import { BROWSER_AUTH_HEADERS, type RequestPrincipal } from '@amcore/shared'

import { hashBrowserBinding } from '../src/core/auth/mfa/browser-binding.js'
import { bindMfaPrincipal } from '../src/core/auth/mfa/mfa-principal-binding.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { assertSessionFresh } from '../src/core/auth/session-freshness.js'
import { BrowserSessionContextService } from '../src/core/frontend-context/browser-session-context.service.js'
import { EnvService } from '../src/env/env.service.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

const transportKey = '<fake-local-sensitive-browser-key-at-least-32>'

describe('Sensitive actions use independently fresh proofs from the exact admitted family', () => {
  const fixture = new MfaProofFixture()
  const transport = new BrowserSessionContextService(
    new EnvService(new ConfigService({ WEB_FRONTEND_CONTEXT_KEY: transportKey }))
  )
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

  async function admitted(protectedAccount = true) {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture, protectedAccount)
    const binding = mfaCredential()
    await db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: { bindingHash: hashBrowserBinding(binding)! },
    })
    const request = {}
    transport.verify(request, {
      [BROWSER_AUTH_HEADERS.key]: transportKey,
      [BROWSER_AUTH_HEADERS.audience]: 'product',
      [BROWSER_AUTH_HEADERS.binding]: binding,
      [BROWSER_AUTH_HEADERS.contextId]: f.requestBinding.contextId,
      [BROWSER_AUTH_HEADERS.generation]: '1',
    })
    const principal: RequestPrincipal = { type: 'jwt', ...f.claims }
    bindMfaPrincipal(request, principal)
    return { ...f, principal, db }
  }

  it.each(['password', 'second_factor', 'both'] as const)(
    'requests only stale %s proof despite a recently touched legacy timestamp',
    async (stale) => {
      const f = await admitted()
      const old = new Date((await mfaDatabaseClock(f.db)).getTime() - 601_000)
      await f.db.authSessionFamily.update({
        where: { id: f.family.id },
        data: {
          ...(stale !== 'second_factor' && { primaryAt: old }),
          ...(stale !== 'password' && { mfaAt: old }),
        },
      })
      const requiredProofs = stale === 'both' ? ['password', 'second_factor'] : [stale]
      await expect(assertSessionFresh(f.db, 600, f.principal)).rejects.toMatchObject({
        errorCode: 'STEP_UP_REQUIRED',
        details: { requiredProofs },
      })
    }
  )

  it('accepts committed recovery-code evidence without consuming another code or renewing proof time', async () => {
    const f = await admitted()
    const before = await f.db.authSessionFamily.update({
      where: { id: f.family.id },
      data: { mfaMethod: 'recovery_code' },
    })
    await f.db.session.update({
      where: { id: f.session.id },
      data: { lastAuthAt: null },
    })
    await expect(assertSessionFresh(f.db, 600, f.principal)).resolves.toBeUndefined()
    expect(await f.db.authSessionFamily.findUnique({ where: { id: before.id } })).toEqual(before)
  })

  it.each([60, 3600])(
    'uses a route window of %s seconds without exceeding ten minutes',
    async (window) => {
      const f = await admitted()
      const now = await mfaDatabaseClock(f.db)
      await f.db.authSessionFamily.update({
        where: { id: f.family.id },
        data: { primaryAt: new Date(now.getTime() - (window === 60 ? 61_000 : 601_000)) },
      })
      await expect(assertSessionFresh(f.db, window, f.principal)).rejects.toMatchObject({
        errorCode: 'STEP_UP_REQUIRED',
        details: { requiredProofs: ['password'] },
      })
    }
  )

  it('does not trust browser fields on a copied principal', async () => {
    const f = await admitted()
    await expect(
      assertSessionFresh(f.db, 600, {
        ...f.principal,
        ...f.requestBinding,
      })
    ).rejects.toMatchObject({ errorCode: 'SESSION_CHANGED' })
  })

  it.each(['revoked', 'epoch', 'browser'] as const)(
    'refuses %s when the action rechecks inside its transaction',
    async (change) => {
      const f = await admitted()
      await expect(assertSessionFresh(f.db, 600, f.principal)).resolves.toBeUndefined()
      if (change === 'revoked')
        await f.db.authSessionFamily.update({
          where: { id: f.family.id },
          data: { revokedAt: await mfaDatabaseClock(f.db) },
        })
      if (change === 'epoch')
        await f.db.mfaAccount.update({
          where: { userId: f.user.id },
          data: { securityVersion: { increment: 1 } },
        })
      if (change === 'browser')
        await f.db.browserAuthContext.update({
          where: { id: f.requestBinding.contextId },
          data: { generation: 2 },
        })
      await expect(
        f.db.$transaction((tx) => assertSessionFresh(tx, 600, f.principal))
      ).rejects.toMatchObject({ errorCode: 'SESSION_CHANGED' })
    }
  )
  it.each(['rotated', 'deleted'] as const)(
    'keeps family freshness with an old %s token row',
    async (state) => {
      const f = await admitted()
      await f.db.session.create({
        data: {
          userId: f.user.id,
          familyId: f.family.id,
          refreshToken: `fake-current-token-${f.user.id}`,
          expiresAt: f.family.expiresAt,
        },
      })
      if (state === 'rotated')
        await f.db.session.update({
          where: { id: f.session.id },
          data: {
            revokedAt: await mfaDatabaseClock(f.db),
            revocationReason: 'rotated',
          },
        })
      else await f.db.session.delete({ where: { id: f.session.id } })
      await expect(assertSessionFresh(f.db, 600, f.principal)).resolves.toBeUndefined()
      await f.db.authSessionFamily.update({
        where: { id: f.family.id },
        data: {
          revokedAt: await mfaDatabaseClock(f.db),
        },
      })
      await expect(assertSessionFresh(f.db, 600, f.principal)).rejects.toMatchObject({
        errorCode: 'SESSION_CHANGED',
      })
    }
  )

  it('requires only primary freshness for an ordinary browser family', async () => {
    const f = await admitted(false)
    await expect(assertSessionFresh(f.db, 600, f.principal)).resolves.toBeUndefined()
    await f.db.authSessionFamily.update({
      where: { id: f.family.id },
      data: {
        primaryAt: new Date((await mfaDatabaseClock(f.db)).getTime() - 601_000),
      },
    })
    await expect(assertSessionFresh(f.db, 600, f.principal)).rejects.toMatchObject({
      errorCode: 'STEP_UP_REQUIRED',
      details: { requiredProofs: ['password'] },
    })
  })
})
