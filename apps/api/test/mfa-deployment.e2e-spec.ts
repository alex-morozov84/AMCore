import { offlineMfaEvents } from '../src/cli/mfa-recovery-events.js'
import { MfaDeployment } from '../src/core/auth/mfa/mfa-deployment.js'
import { MfaFoundationService } from '../src/core/auth/mfa/mfa-foundation.service.js'
import { requireOfflineMfaAuthority } from '../src/core/auth/mfa/mfa-offline-authority.js'
import type { MfaSecurityEvents } from '../src/core/auth/mfa/mfa-security-events.service.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import { MfaProofFixture } from './mfa-proof.fixture.js'

/** Only this owned disposable database changes protocol; no application deployment or ingress is touched. */
describe('Deployment protocol transaction and local startup fence', () => {
  const fixture = new MfaProofFixture()
  const evidence = { evidenceHash: 'a'.repeat(64), sourceCommit: 'b'.repeat(40) }
  beforeAll(() => fixture.start(), 120000)
  afterAll(() => fixture.close(), 60000)
  beforeEach(async () => {
    const db = fixture.clients[0]!
    await db.user.deleteMany()
    await db.browserAuthContext.deleteMany()
    await db.mfaProtocol.upsert({
      where: { id: 'platform' },
      create: { id: 'platform', state: 'prepared' },
      update: { state: 'prepared', version: 1 },
    })
  })
  const service = () =>
    new MfaDeployment(fixture.clients[0]!, fixture.codec, offlineMfaEvents(fixture.clients[0]!))

  it('preflights without activation, commits activation/audit once and admits compatible keyed startup', async () => {
    const db = fixture.clients[0]!,
      deployment = service()
    await deployment.preflight()
    expect(await deployment.status()).toEqual({ state: 'prepared', version: 1 })
    expect(await deployment.activate(evidence)).toBe('activated')
    expect(await deployment.activate(evidence)).toBe('already_active')
    expect(await deployment.status()).toEqual({ state: 'active', version: 1 })
    const audit = await db.auditLog.findMany({ where: { action: 'auth.mfa_protocol_activated' } })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      actorType: 'SYSTEM',
      targetId: 'auth.mfa.protocol',
      metadata: { actorDatabaseRole: 'test', ...evidence },
    })
    await expect(
      new MfaFoundationService(db as unknown as PrismaService, fixture.codec).onModuleInit()
    ).resolves.toBeUndefined()
  })

  it('rolls back protocol activation when mandatory audit fails', async () => {
    const db = fixture.clients[0]!
    const broken = {
      protocolActivated: async () => {
        throw new Error('audit unavailable')
      },
    } as unknown as MfaSecurityEvents
    await expect(new MfaDeployment(db, fixture.codec, broken).activate(evidence)).rejects.toThrow(
      'audit unavailable'
    )
    expect(await service().status()).toEqual({ state: 'prepared', version: 1 })
  })

  it('refuses unsupported state, missing retained keys and protected data before activation', async () => {
    const db = fixture.clients[0]!
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { version: 2 } })
    await expect(service().preflight()).rejects.toThrow('incompatible_protocol')
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { version: 1 } })
    const f = await createAuthorityAccount(fixture)
    await expect(service().preflight()).rejects.toThrow('protected_data_before_activation')
    await db.mfaProtocol.update({ where: { id: 'platform' }, data: { state: 'active' } })
    await db.mfaFactor.update({
      where: { userId: f.user.id },
      data: { keyId: 'missing-retained-key' },
    })
    await expect(service().preflight()).rejects.toThrow('MFA encryption key unavailable')
  })

  it('does not confuse runtime table DML with database owner authority', async () => {
    const db = fixture.clients[0]!
    await db.$executeRawUnsafe('CREATE ROLE mfa_deployment_runtime_fixture NOLOGIN')
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA core TO mfa_deployment_runtime_fixture')
    await db.$executeRawUnsafe(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core TO mfa_deployment_runtime_fixture'
    )
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE mfa_deployment_runtime_fixture')
      await expect(requireOfflineMfaAuthority(tx)).rejects.toThrow('database owner authority')
    })
    expect(await service().status()).toEqual({ state: 'prepared', version: 1 })
  })
})
