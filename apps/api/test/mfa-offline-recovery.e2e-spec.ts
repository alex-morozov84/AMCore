import { jest } from '@jest/globals'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

import { requireOfflineMfaAuthority } from '../src/core/auth/mfa/mfa-offline-authority.js'
import { MfaOfflineRecovery } from '../src/core/auth/mfa/mfa-offline-recovery.js'
import { recoveryTicketHash } from '../src/core/auth/mfa/mfa-recovery-ticket.js'
import { mfaDatabaseClock } from '../src/core/auth/mfa/mfa-transaction.js'
import { PrismaClient } from '../src/generated/prisma/client.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'
import { verificationFixture } from './mfa-verification.fixture.js'

describe('Offline recovery transaction requires actual database administrative authority', () => {
  const fixture = new MfaProofFixture()
  const reason = 'lost phone and all backup codes'
  beforeAll(async () => {
    await fixture.start()
    const db = fixture.clients[0]!
    await db.$executeRawUnsafe(
      "CREATE ROLE mfa_runtime_test LOGIN PASSWORD 'fixture-limited-not-secret'"
    )
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA core TO mfa_runtime_test')
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA notifications TO mfa_runtime_test')
    await db.$executeRawUnsafe(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA notifications TO mfa_runtime_test'
    )
    await db.$executeRawUnsafe(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO mfa_runtime_test'
    )
  }, 120000)
  afterAll(() => fixture.close(), 60000)
  afterEach(() => jest.restoreAllMocks())
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

  it('atomically resets protected authority, records audit/notification and stores only a15min ticket hash', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    await db.$transaction((tx) => fixture.first.replaceBackupCodes(tx, f.user.id, 3, 0))
    // Reset does not need the lost read key or decrypt the unusable factor.
    await db.mfaFactor.update({ where: { userId: f.user.id }, data: { keyId: 'missing-old-key' } })
    const { events } = verificationFixture(fixture)
    const before = await mfaDatabaseClock(db)
    const issued = await new MfaOfflineRecovery(db, events).issue({
      userId: f.user.id,
      reason,
      confirmation: `RESET ${f.user.id}`,
    })
    expect(/^[A-Za-z0-9_-]{43}$/.test(issued.ticket)).toBe(true)
    expect(issued.expiresAt.getTime()).toBeGreaterThanOrEqual(before.getTime() + 900_000)
    expect(await db.mfaAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).toMatchObject({
      securityVersion: 4,
      required: true,
      setupComplete: false,
      emergencyRequired: true,
      codeGeneration: 2,
    })
    expect(await db.mfaFactor.count({ where: { userId: f.user.id } })).toBe(0)
    expect(await db.mfaRecoveryCode.count({ where: { userId: f.user.id } })).toBe(0)
    expect(
      (await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).revokedAt
    ).not.toBeNull()
    expect(
      (await db.session.findUniqueOrThrow({ where: { id: f.session.id } })).revokedAt
    ).not.toBeNull()
    expect((await db.mfaFlow.findUniqueOrThrow({ where: { id: f.flow.id } })).state).toBe('retired')
    const ticket = await db.mfaRecoveryTicket.findUniqueOrThrow({ where: { userId: f.user.id } })
    expect(ticket.credentialHash === recoveryTicketHash(issued.ticket)).toBe(true)
    expect(ticket).toMatchObject({
      securityVersion: 4,
      expiresAt: issued.expiresAt,
      consumedAt: null,
    })
    const audit = await db.auditLog.findMany({
      where: { action: 'auth.mfa_offline_recovery_started', targetId: f.user.id },
    })
    expect(audit).toHaveLength(1)
    expect(audit[0]!.metadata).toMatchObject({
      operationId: issued.operationId,
      reason,
      actorDatabaseRole: 'test',
    })
    const notifications = await db.notification.findMany({ where: { recipientUserId: f.user.id } })
    expect(notifications).toHaveLength(1)
    expect(
      await db.notificationDelivery.count({ where: { notificationId: notifications[0]!.id } })
    ).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify({ ticket, audit, notifications }).includes(issued.ticket)).toBe(false)
  })

  it('rolls back factor/session/epoch/ticket and strict audit if notification intent cannot commit', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const factor = await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })
    const { events, notifications } = verificationFixture(fixture)
    jest
      .spyOn(notifications, 'notifyTx')
      .mockRejectedValueOnce(new Error('notification unavailable'))
    await expect(
      new MfaOfflineRecovery(db, events).issue({
        userId: f.user.id,
        reason,
        confirmation: `RESET ${f.user.id}`,
      })
    ).rejects.toThrow('notification unavailable')
    expect(await db.mfaFactor.findUniqueOrThrow({ where: { userId: f.user.id } })).toEqual(factor)
    expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
      f.family
    )
    expect(await db.session.findUniqueOrThrow({ where: { id: f.session.id } })).toEqual(f.session)
    expect(
      (await db.mfaAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).securityVersion
    ).toBe(3)
    expect(await db.mfaRecoveryTicket.count()).toBe(0)
    expect(await db.auditLog.count({ where: { targetId: f.user.id } })).toBe(0)
  })

  it.each(['no_password', 'wrong_confirmation', 'ordinary_account', 'prepared_protocol'])(
    'refuses %s before changing the account',
    async (failure) => {
      const db = fixture.clients[0]!
      const f = await createAuthorityAccount(fixture, failure !== 'ordinary_account')
      if (failure === 'no_password')
        await db.user.update({ where: { id: f.user.id }, data: { passwordHash: null } })
      if (failure === 'prepared_protocol')
        await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'prepared' } })
      await expect(
        new MfaOfflineRecovery(db, verificationFixture(fixture).events).issue({
          userId: f.user.id,
          reason,
          confirmation: failure === 'wrong_confirmation' ? 'RESET wrong' : `RESET ${f.user.id}`,
        })
      ).rejects.toThrow()
      expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
        f.family
      )
      expect(await db.mfaRecoveryTicket.count()).toBe(0)
    }
  )

  it('rolls back reset if administrative membership is revoked while strict event production runs', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const url = new URL(fixture.connectionUri)
    url.username = 'mfa_runtime_test'
    url.password = 'fixture-limited-not-secret'
    const pool = new Pool({ connectionString: url.toString() })
    const runtime = new PrismaClient({ adapter: new PrismaPg(pool) })
    await db.$executeRawUnsafe('GRANT test TO mfa_runtime_test')
    const { events } = verificationFixture(fixture)
    const record = events.recoveryReset.bind(events)
    jest.spyOn(events, 'recoveryReset').mockImplementationOnce(async (...args) => {
      await record(...args)
      await db.$executeRawUnsafe('REVOKE test FROM mfa_runtime_test')
    })
    try {
      await expect(
        new MfaOfflineRecovery(runtime, events).issue({
          userId: f.user.id,
          reason,
          confirmation: `RESET ${f.user.id}`,
        })
      ).rejects.toMatchObject({ status: 403 })
      expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
        f.family
      )
      expect(await db.mfaRecoveryTicket.count()).toBe(0)
      expect(await db.auditLog.count({ where: { targetId: f.user.id } })).toBe(0)
      expect(await db.notification.count({ where: { recipientUserId: f.user.id } })).toBe(0)
    } finally {
      await db.$executeRawUnsafe('REVOKE test FROM mfa_runtime_test')
      await runtime.$disconnect()
      await pool.end()
    }
  })

  it('refuses a runtime DML role and accepts actual owner-role membership', async () => {
    const db = fixture.clients[0]!
    const f = await createAuthorityAccount(fixture)
    const url = new URL(fixture.connectionUri)
    url.username = 'mfa_runtime_test'
    url.password = 'fixture-limited-not-secret'
    const pool = new Pool({ connectionString: url.toString() })
    const runtime = new PrismaClient({ adapter: new PrismaPg(pool) })
    try {
      await expect(requireOfflineMfaAuthority(runtime)).rejects.toMatchObject({ status: 403 })
      await expect(
        new MfaOfflineRecovery(runtime, verificationFixture(fixture).events).issue({
          userId: f.user.id,
          reason,
          confirmation: `RESET ${f.user.id}`,
        })
      ).rejects.toMatchObject({ status: 403 })
      expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
        f.family
      )
      await db.$executeRawUnsafe('GRANT test TO mfa_runtime_test')
      await expect(requireOfflineMfaAuthority(runtime)).resolves.toBe('mfa_runtime_test')
    } finally {
      await db.$executeRawUnsafe('REVOKE test FROM mfa_runtime_test')
      await runtime.$disconnect()
      await pool.end()
    }
  })
})
