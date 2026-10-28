import { randomUUID } from 'node:crypto'

import type { PinoLogger } from 'nestjs-pino'

import { SystemRole } from '@amcore/shared'

import type { AdminCommandAdmission } from '../src/core/admin/admin-command-admission.js'
import { AdminSessionsService } from '../src/core/admin/admin-sessions.service.js'
import type { AuditLogService } from '../src/core/audit/index.js'
import { lockMfaFlow } from '../src/core/auth/mfa/mfa-flow-lock.js'
import { SessionService } from '../src/core/auth/session.service.js'
import type { TokenService } from '../src/core/auth/token.service.js'
import type { GeoIpService } from '../src/infrastructure/geoip/geoip.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { authorityReader } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'
import { revocationGraph } from './mfa-session-revocation.fixture.js'

describe('Family revocation closes its continuations without becoming an account lockout', () => {
  const fixture = new MfaProofFixture()
  const logger = { setContext: () => undefined, info: () => undefined } as unknown as PinoLogger
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

  function services() {
    const db = fixture.clients[0]! as unknown as PrismaService
    return {
      own: new SessionService(db, {} as TokenService, {} as GeoIpService, logger),
      admin: new AdminSessionsService(
        db,
        {} as GeoIpService,
        {
          record: async () => undefined,
        } as unknown as AuditLogService,
        logger,
        { assert: async () => undefined } as unknown as AdminCommandAdmission
      ),
    }
  }

  it.each([
    'own_one',
    'browser_logout',
    'own_all',
    'own_others',
    'admin_one',
    'admin_all',
  ] as const)(
    'retires exact F through %s; independent pre-login authority survives',
    async (path) => {
      const f = await revocationGraph(fixture)
      const { own, admin } = services()
      const actor = { type: 'jwt' as const, sub: randomUUID(), systemRole: SystemRole.SuperAdmin }
      if (path === 'own_one') await own.deleteSession(f.session.id, f.user.id)
      if (path === 'browser_logout')
        await own.logoutBrowser(f.requestBinding, f.session.refreshToken)
      if (path === 'own_all') await own.deleteAllByUserId(f.user.id)
      if (path === 'own_others') await own.deleteOtherSessions(f.user.id, f.other.refreshToken)
      if (path === 'admin_one') await admin.revokeOne(f.user.id, f.family.id, actor)
      if (path === 'admin_all') await admin.revokeAll(f.user.id, actor)
      expect(await f.db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toMatchObject(
        { revokedAt: expect.any(Date), publicationState: 'retired' }
      )
      expect(await f.db.$transaction((tx) => lockMfaFlow(tx, f.source))).toBeNull()
      expect(await f.db.$transaction((tx) => lockMfaFlow(tx, f.direct))).not.toBeNull()
      expect(await f.db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
        securityVersion: 3,
      })
      expect((await authorityReader(f.db).read(f.claims, f.requestBinding)).kind).toBe('denied')
      const revoked = expect.objectContaining({ revokedAt: expect.any(Date) })
      const all = path === 'own_all' || path === 'admin_all'
      expect(await f.db.authSessionFamily.findUnique({ where: { id: f.g.id } })).toEqual(
        all ? revoked : f.g
      )
      const retained = path === 'own_all' ? null : f.other
      expect(await f.db.session.findUnique({ where: { id: f.other.id } })).toEqual(
        path === 'admin_all' ? revoked : retained
      )
    }
  )

  it('rejects an unknown keep-token before revoking any family or deleting a session', async () => {
    const f = await revocationGraph(fixture)
    await expect(
      services().own.deleteOtherSessions(f.user.id, 'missing-hash')
    ).rejects.toMatchObject({ errorCode: 'SESSION_CHANGED' })
    expect(await f.db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(
      f.family
    )
    expect(await f.db.session.findUnique({ where: { id: f.other.id } })).toEqual(f.other)
  })

  it('deletes only an expired old token row without retiring its live refreshed family', async () => {
    const f = await revocationGraph(fixture)
    await f.db.session.update({
      where: { id: f.session.id },
      data: { expiresAt: new Date(0) },
    })
    const child = await f.db.session.create({
      data: {
        userId: f.user.id,
        familyId: f.family.id,
        refreshToken: `fake-expiration-child-${randomUUID()}`,
        expiresAt: f.family.expiresAt,
      },
    })
    await expect(
      services().own.validateRefreshToken(f.session.refreshToken, f.requestBinding)
    ).rejects.toMatchObject({ errorCode: 'TOKEN_INVALID' })
    expect(await f.db.session.findUnique({ where: { id: f.session.id } })).toBeNull()
    expect(await f.db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(
      f.family
    )
    expect(await f.db.session.findUnique({ where: { id: child.id } })).toEqual(child)
    expect(await f.db.$transaction((tx) => lockMfaFlow(tx, f.source))).not.toBeNull()
  })

  it('keeps historical revoke-one idempotent after its original token rows were removed', async () => {
    const f = await revocationGraph(fixture)
    const { own, admin } = services()
    await own.deleteSession(f.session.id, f.user.id)
    await expect(
      admin.revokeOne(f.user.id, f.family.id, {
        type: 'jwt',
        sub: randomUUID(),
        systemRole: SystemRole.SuperAdmin,
      })
    ).resolves.toEqual({ affected: 0 })
    expect(await f.db.authSessionFamily.findUnique({ where: { id: f.g.id } })).toEqual(f.g)
    expect(await f.db.$transaction((tx) => lockMfaFlow(tx, f.direct))).not.toBeNull()
  })

  it('refuses legacy logout for a browser family when private browser evidence was omitted', async () => {
    const f = await revocationGraph(fixture)
    await expect(services().own.deleteByRefreshToken(f.session.refreshToken)).rejects.toMatchObject(
      { errorCode: 'SESSION_CHANGED' }
    )
    expect(await f.db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(
      f.family
    )
    expect(await f.db.session.findUnique({ where: { id: f.session.id } })).toEqual(f.session)
  })

  it.each(['old_generation', 'new_generation_old_cookie'] as const)(
    'does not log out a later account through %s',
    async (path) => {
      const f = await revocationGraph(fixture)
      const user = await f.db.user.create({
        data: {
          email: `later-${randomUUID()}@example.test`,
          emailCanonical: `later-${randomUUID()}@example.test`,
        },
      })
      const later = await f.db.authSessionFamily.create({
        data: {
          ...f.family,
          id: randomUUID(),
          userId: user.id,
          publicationGeneration: 2,
        },
      })
      const context = await f.db.browserAuthContext.update({
        where: { id: f.requestBinding.contextId },
        data: { generation: 2, currentFamilyId: later.id },
      })
      const binding =
        path === 'old_generation' ? f.requestBinding : { ...f.requestBinding, generation: 2 }
      await expect(
        services().own.logoutBrowser(binding, f.session.refreshToken)
      ).rejects.toMatchObject({ errorCode: 'SESSION_CHANGED' })
      expect(await f.db.browserAuthContext.findUnique({ where: { id: context.id } })).toEqual(
        context
      )
      expect(await f.db.authSessionFamily.findUnique({ where: { id: later.id } })).toEqual(later)
      expect(await f.db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(
        f.family
      )
    }
  )

  it('logs out the exact pending browser generation without any ordinary refresh cookie', async () => {
    const f = await revocationGraph(fixture)
    const pending = await f.db.mfaFlow.create({
      data: {
        userId: f.user.id,
        credentialHash: `fake-pending-${randomUUID()}`,
        purpose: 'login',
        authorityKind: 'identity',
        audience: 'product',
        browserContextId: f.requestBinding.contextId,
        publicationGeneration: 2,
        bindingHash: f.requestBinding.bindingHash,
        securityVersion: 3,
        expiresAt: f.family.expiresAt,
      },
    })
    await f.db.browserAuthContext.update({
      where: { id: f.requestBinding.contextId },
      data: {
        generation: 2,
        state: 'reserved',
        currentFamilyId: null,
        reservedFlowId: pending.id,
      },
    })
    await services().own.logoutBrowser({ ...f.requestBinding, generation: 2 })
    expect(await f.db.mfaFlow.findUnique({ where: { id: pending.id } })).toMatchObject({
      state: 'retired',
    })
    expect(
      await f.db.browserAuthContext.findUnique({ where: { id: f.requestBinding.contextId } })
    ).toMatchObject({
      generation: 3,
      state: 'logged_out',
      currentFamilyId: null,
      reservedFlowId: null,
    })
    expect(await f.db.authSessionFamily.findUnique({ where: { id: f.g.id } })).toEqual(f.g)
    expect(await f.db.$transaction((tx) => lockMfaFlow(tx, f.direct))).not.toBeNull()
  })

  it('revokes an independent API family without changing browser publication or account epoch', async () => {
    const f = await revocationGraph(fixture)
    await services().own.deleteByRefreshToken(f.other.refreshToken)
    expect(await f.db.authSessionFamily.findUnique({ where: { id: f.g.id } })).toMatchObject({
      revokedAt: expect.any(Date),
      publicationState: 'retired',
    })
    expect(await f.db.authSessionFamily.findUnique({ where: { id: f.family.id } })).toEqual(
      f.family
    )
    expect(await f.db.$transaction((tx) => lockMfaFlow(tx, f.source))).not.toBeNull()
    expect(await f.db.mfaAccount.findUnique({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 3,
    })
  })
})
