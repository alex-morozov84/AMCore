import { spawnSync } from 'node:child_process'

import * as argon2 from 'argon2'

import { recoveryTicketHash } from '../src/core/auth/mfa/mfa-recovery-ticket.js'

import { loginStartFixture } from './mfa-login-start.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'
import { recoveryTerminalFixture } from './mfa-recovery-terminal.fixture.js'

const password = '<fake-owned-terminal-recovery-password>'
describe('Offline MFA CLI uses a private PTY and actual DB authority, never JSON credentials', () => {
  const fixture = new MfaProofFixture()
  let hash: string
  beforeAll(async () => {
    hash = await argon2.hash(password)
    await fixture.start()
    const db = fixture.clients[0]!
    await db.$executeRawUnsafe(
      "CREATE ROLE mfa_cli_runtime LOGIN PASSWORD 'fixture-limited-not-secret'"
    )
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA core TO mfa_cli_runtime')
    await db.$executeRawUnsafe(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO mfa_cli_runtime'
    )
  }, 120000)
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

  it('shows one ticket only in a private terminal, commits audit/intent and honours later cancellation', async () => {
    const db = fixture.clients[0]!
    const f = await loginStartFixture(fixture, hash)
    const result = await recoveryTerminalFixture({
      userId: f.user.id,
      databaseUrl: fixture.connectionUri,
    })
    expect(result.status).toBe(0)
    expect(result.body).toMatchObject({ status: 'issued', userId: f.user.id })
    expect(result.ticket !== null).toBe(true)
    const ticket = await db.mfaRecoveryTicket.findUniqueOrThrow({ where: { userId: f.user.id } })
    expect(ticket.credentialHash === recoveryTicketHash(result.ticket)).toBe(true)
    expect(JSON.stringify(result.body).includes(result.ticket!)).toBe(false)
    expect(result.safeOutput.includes(fixture.connectionUri)).toBe(false)
    expect(
      (await db.mfaAccount.findUniqueOrThrow({ where: { userId: f.user.id } })).securityVersion
    ).toBe(4)
    expect(
      await db.auditLog.count({
        where: { action: 'auth.mfa_offline_recovery_started', targetId: f.user.id },
      })
    ).toBe(1)
    expect(await db.notification.count({ where: { recipientUserId: f.user.id } })).toBe(1)
    const cancelled = await recoveryTerminalFixture({
      userId: f.user.id,
      databaseUrl: fixture.connectionUri,
      confirm: false,
    })
    expect(cancelled.status).toBe(0)
    expect(cancelled.body).toMatchObject({ status: 'cancelled' })
    expect(cancelled.ticket).toBeNull()
    expect(await db.mfaRecoveryTicket.findUniqueOrThrow({ where: { userId: f.user.id } })).toEqual(
      ticket
    )
  }, 120000)

  it('refuses a pipe before reset even with database owner credentials', async () => {
    const db = fixture.clients[0]!
    const f = await loginStartFixture(fixture, hash)
    const child = spawnSync('pnpm', ['auth:mfa', '--', 'recover', '--user-id', f.user.id], {
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: fixture.connectionUri },
      encoding: 'utf8',
      timeout: 30000,
    })
    expect(child.status).toBe(3)
    expect(child.stdout.includes('private_terminal_required')).toBe(true)
    expect(await db.mfaRecoveryTicket.count()).toBe(0)
    expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
      f.family
    )
  }, 60000)

  it('refuses actual runtime DML credentials before prompting or changing target state', async () => {
    const db = fixture.clients[0]!
    const f = await loginStartFixture(fixture, hash)
    const url = new URL(fixture.connectionUri)
    url.username = 'mfa_cli_runtime'
    url.password = 'fixture-limited-not-secret'
    const result = await recoveryTerminalFixture({ userId: f.user.id, databaseUrl: url.toString() })
    expect(result.status).toBe(3)
    expect(result.body).toMatchObject({ status: 'refused' })
    expect(result.ticket).toBeNull()
    expect(result.safeOutput.includes('Reason (no passwords')).toBe(false)
    expect(await db.mfaRecoveryTicket.count()).toBe(0)
    expect(await db.authSessionFamily.findUniqueOrThrow({ where: { id: f.family.id } })).toEqual(
      f.family
    )
  }, 60000)
})
