import { jest } from '@jest/globals'

import { SystemRole } from '@amcore/shared'

import { SupportMailStore } from '../src/core/admin/support-mail/support-mail.store.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { admitSetupOperator } from '../src/core/organizations/organization-setup-admission.js'
import type { PrismaService } from '../src/prisma/index.js'

import { adminCommandFixture } from './mfa-admin-command.fixture.js'
import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

describe('Operator role/session commands recheck current family proofs in the mutation transaction', () => {
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

  it('commits role, epoch, session/family revocation and audit together; no-op changes none of them', async () => {
    const db = fixture.clients[0]!
    const target = await createAuthorityAccount(fixture)
    const actor = await adminCommandFixture(fixture)
    await actor.roleService.updateUserSystemRole(
      target.user.id,
      SystemRole.SuperAdmin,
      actor.principal
    )
    expect(await db.mfaAccount.findUnique({ where: { userId: target.user.id } })).toMatchObject({
      securityVersion: 3,
    })
    expect(
      await db.auditLog.count({
        where: { action: 'admin.user.system_role_changed', targetId: target.user.id },
      })
    ).toBe(0)
    await actor.roleService.updateUserSystemRole(target.user.id, SystemRole.User, actor.principal)
    expect(await db.user.findUnique({ where: { id: target.user.id } })).toMatchObject({
      systemRole: SystemRole.User,
    })
    expect(await db.mfaAccount.findUnique({ where: { userId: target.user.id } })).toMatchObject({
      securityVersion: 4,
    })
    expect(
      await db.authSessionFamily.findUnique({ where: { id: target.family.id } })
    ).toMatchObject({ revokedAt: expect.any(Date) })
    expect(await db.session.findUnique({ where: { id: target.session.id } })).toBeNull()
    expect(
      await db.auditLog.count({
        where: { action: 'admin.user.system_role_changed', targetId: target.user.id },
      })
    ).toBe(1)
    expect(
      await db.authSessionFamily.findUnique({ where: { id: actor.operator.family.id } })
    ).toEqual(actor.operator.family)
  })

  it('rolls back role, epoch and revocation when the strict audit fails', async () => {
    const db = fixture.clients[0]!
    const target = await createAuthorityAccount(fixture)
    const actor = await adminCommandFixture(fixture)
    jest.spyOn(actor.audit, 'record').mockRejectedValueOnce(new Error('controlled audit failure'))
    await expect(
      actor.roleService.updateUserSystemRole(target.user.id, SystemRole.User, actor.principal)
    ).rejects.toThrow('controlled audit failure')
    expect(await db.user.findUnique({ where: { id: target.user.id } })).toEqual(target.user)
    expect(await db.mfaAccount.findUnique({ where: { userId: target.user.id } })).toMatchObject({
      securityVersion: 3,
    })
    expect(await db.session.findUnique({ where: { id: target.session.id } })).toEqual(
      target.session
    )
    expect(await db.authSessionFamily.findUnique({ where: { id: target.family.id } })).toEqual(
      target.family
    )
  })

  it('rechecks the proof deadline after audit waits and rolls back the whole command', async () => {
    const db = fixture.clients[0]!
    const target = await createAuthorityAccount(fixture)
    const actor = await adminCommandFixture(fixture, 2)
    const original = actor.audit.record.bind(actor.audit)
    const proofAt = await mfaDatabaseClock(db)
    await db.authSessionFamily.update({
      where: { id: actor.operator.family.id },
      data: {
        primaryAt: proofAt,
        mfaAt: proofAt,
      },
    })
    const deadline = new Date(proofAt.getTime() + 2100)
    let waited = false
    jest.spyOn(actor.audit, 'record').mockImplementation(async (entry, options) => {
      // Wait for the known database proof deadline, not a guessed simultaneous-request arrival.
      await options!.tx!
        .$executeRaw`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (${deadline}::timestamptz - clock_timestamp()))))`
      waited = true
      return original(entry, options)
    })
    await expect(
      actor.roleService.updateUserSystemRole(target.user.id, SystemRole.User, actor.principal)
    ).rejects.toMatchObject({
      errorCode: 'STEP_UP_REQUIRED',
      details: { requiredProofs: ['password', 'second_factor'] },
    })
    expect(waited).toBe(true)
    expect(await db.user.findUnique({ where: { id: target.user.id } })).toEqual(target.user)
    expect(await db.authSessionFamily.findUnique({ where: { id: target.family.id } })).toEqual(
      target.family
    )
    expect(
      await db.auditLog.count({
        where: { action: 'admin.user.system_role_changed', targetId: target.user.id },
      })
    ).toBe(0)
  })

  it.each(['stale_proof', 'revoked_family', 'role_demoted'] as const)(
    'rejects %s before target session mutation',
    async (reason) => {
      const db = fixture.clients[0]!
      const target = await createAuthorityAccount(fixture)
      const actor = await adminCommandFixture(fixture)
      const now = await mfaDatabaseClock(db)
      if (reason === 'stale_proof')
        await db.authSessionFamily.update({
          where: { id: actor.operator.family.id },
          data: {
            mfaAt: new Date(now.getTime() - 601_000),
          },
        })
      if (reason === 'revoked_family')
        await db.authSessionFamily.update({
          where: { id: actor.operator.family.id },
          data: { revokedAt: now },
        })
      if (reason === 'role_demoted')
        await db.user.update({
          where: { id: actor.operator.user.id },
          data: { systemRole: SystemRole.User },
        })
      const codes = {
        stale_proof: 'STEP_UP_REQUIRED',
        revoked_family: 'SESSION_CHANGED',
        role_demoted: 'FORBIDDEN',
      }
      await expect(
        actor.sessions.revokeOne(target.user.id, target.family.id, actor.principal)
      ).rejects.toMatchObject({ errorCode: codes[reason] })
      expect(await db.authSessionFamily.findUnique({ where: { id: target.family.id } })).toEqual(
        target.family
      )
      expect(await db.session.findUnique({ where: { id: target.session.id } })).toEqual(
        target.session
      )
      expect(
        await db.auditLog.count({
          where: { action: 'admin.user.session_revoked', targetId: target.user.id },
        })
      ).toBe(0)
    }
  )

  it('keeps support-mail and organization admission tied to F after an old SID was removed', async () => {
    const db = fixture.clients[0]!
    const target = await createAuthorityAccount(fixture)
    const actor = await adminCommandFixture(fixture)
    await db.session.create({
      data: {
        userId: actor.operator.user.id,
        familyId: actor.operator.family.id,
        refreshToken: `fake-current-${actor.operator.user.id}`,
        expiresAt: actor.operator.family.expiresAt,
      },
    })
    await db.session.delete({ where: { id: actor.operator.session.id } })
    const mail = new SupportMailStore(db as unknown as PrismaService)
    await expect(
      db.$transaction((tx) => mail.admit(tx, actor.principal, target.user.id))
    ).resolves.toMatchObject({ id: target.user.id })
    await expect(
      db.$transaction((tx) =>
        admitSetupOperator(tx, { principal: actor.principal, freshWindowSeconds: 600 })
      )
    ).resolves.toBeUndefined()
    await db.authSessionFamily.update({
      where: { id: actor.operator.family.id },
      data: { revokedAt: await mfaDatabaseClock(db) },
    })
    await expect(
      db.$transaction((tx) => mail.admit(tx, actor.principal, target.user.id))
    ).rejects.toMatchObject({ errorCode: 'SESSION_CHANGED' })
    await expect(
      db.$transaction((tx) =>
        admitSetupOperator(tx, { principal: actor.principal, freshWindowSeconds: 600 })
      )
    ).rejects.toMatchObject({ errorCode: 'SESSION_CHANGED' })
  })
})
