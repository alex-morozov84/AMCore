import { createHash, randomBytes } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

describe('Audit capture points (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let context: E2ETestContext

  beforeAll(async () => {
    context = await setupE2ETest()
    app = context.app
    prisma = context.prisma
    await seedSystemRoles(prisma)
  }, 120000)

  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)

  beforeEach(async () => {
    await unblockAuditInserts()
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
  })

  afterEach(async () => {
    await unblockAuditInserts()
  })

  it('records admin role change, session revocation, and cleanup actions', async () => {
    const baseline = await prisma.auditLog.count()
    const { userId: targetId } = await register('target@example.com')
    const admin = await register('superadmin@example.com')
    const steppedUp = await promoteAndStepUp(admin)

    await request(app.getHttpServer())
      .patch(`/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${steppedUp}`)
      .send({ systemRole: 'SUPER_ADMIN' })
      .expect(200)

    await request(app.getHttpServer())
      .post('/admin/cleanup')
      .set('Authorization', `Bearer ${steppedUp}`)
      .expect(200)

    const rows = await auditRowsSince(baseline)
    expect(findAudit(rows, 'admin.user.system_role_changed')?.metadata).toMatchObject({
      afterSystemRole: 'SUPER_ADMIN',
      beforeSystemRole: 'USER',
      pinoEvent: 'auth.admin.system_role_changed',
    })
    expect(findAudit(rows, 'admin.user.sessions_revoked')?.metadata).toMatchObject({
      count: 1,
      pinoEvent: 'auth.admin.sessions_revoked',
      reason: 'system_role_changed',
    })
    expect(findAudit(rows, 'admin.cleanup.executed')?.metadata).toMatchObject({
      counts: expect.any(Object),
      pinoEvent: 'auth.admin.cleanup_executed',
    })
    expect(await prisma.session.count({ where: { userId: targetId } })).toBe(0)
  })

  it('records step-up success and failure without secret metadata', async () => {
    const baseline = await prisma.auditLog.count()
    const auth = await register('stepup@example.com')

    await request(app.getHttpServer())
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${auth.token}`)
      .send({ password: 'WrongP@ss123' })
      .expect(401)

    await request(app.getHttpServer())
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${auth.token}`)
      .send({ password: 'StrongP@ss123' })
      .expect(200)

    const rows = await auditRowsSince(baseline)
    expect(findAudit(rows, 'auth.step_up_failed')?.metadata).toMatchObject({
      pinoEvent: 'auth.step_up.failed',
      reason: 'invalid_password',
    })
    expect(findAudit(rows, 'auth.step_up_succeeded')?.metadata).toMatchObject({
      pinoEvent: 'auth.step_up.succeeded',
      sessionId: expect.any(String),
    })
    expect(JSON.stringify(rows)).not.toContain('WrongP@ss123')
  })

  it('records api key create and revoke without key material', async () => {
    const auth = await register('keys@example.com')
    const organizationId = await createOrganization(auth.token)
    const baseline = await prisma.auditLog.count()

    const created = await request(app.getHttpServer())
      .post('/api-keys')
      .set('Authorization', `Bearer ${auth.token}`)
      .send({ name: 'CI Key', organizationId, scopes: ['read:User'] })
      .expect(201)

    await request(app.getHttpServer())
      .delete(`/api-keys/${created.body.id as string}`)
      .set('Authorization', `Bearer ${auth.token}`)
      .expect(204)

    const rows = await auditRowsSince(baseline)
    expect(findAudit(rows, 'api_key.created')?.metadata).toMatchObject({
      name: 'CI Key',
      pinoEvent: 'api_key.created',
      scopes: ['read:User'],
    })
    expect(findAudit(rows, 'api_key.revoked')?.metadata).toMatchObject({
      pinoEvent: 'api_key.revoked',
      reason: 'user_revoked',
    })
    expect(JSON.stringify(rows)).not.toContain(created.body.key as string)
    expect(JSON.stringify(rows)).not.toContain('shortToken')
    expect(JSON.stringify(rows)).not.toContain('salt')
  })

  it('records invite create, accept, and revoke without raw email or token', async () => {
    const admin = await register('orgadmin@example.com')
    const orgId = await createOrganization(admin.token)
    const orgToken = await switchOrganization(admin.token, orgId)
    const invitee = await register('invitee@example.com')
    await prisma.user.update({
      where: { id: invitee.userId },
      data: { emailVerified: true },
    })

    const createBaseline = await prisma.auditLog.count()
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/members/invite`)
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ email: 'invitee@example.com' })
      .expect(202)

    const createdInvite = await prisma.orgInvite.findFirstOrThrow({
      where: { organizationId: orgId, emailCanonical: 'invitee@example.com' },
      select: { id: true },
    })
    const createdAudit = findAudit(await auditRowsSince(createBaseline), 'org.invite_created')
    expect(createdAudit?.metadata).toMatchObject({
      actorCredentialType: 'jwt',
      branch: 'pending_known_user',
      emailHash: expect.any(String),
      pinoEvent: 'org.invite.created',
    })

    const revokeBaseline = await prisma.auditLog.count()
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/invites/${createdInvite.id}`)
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(204)

    expect(
      findAudit(await auditRowsSince(revokeBaseline), 'org.invite_revoked')?.metadata
    ).toMatchObject({
      actorCredentialType: 'jwt',
      emailHash: expect.any(String),
      pinoEvent: 'org.invite.revoked',
    })

    const acceptBaseline = await prisma.auditLog.count()
    const seeded = await seedInvite(orgId, admin.userId, 'invitee@example.com')
    await request(app.getHttpServer())
      .post('/auth/invites/accept')
      .set('Authorization', `Bearer ${invitee.token}`)
      .send({ token: seeded.rawToken })
      .expect(200)

    expect(
      findAudit(await auditRowsSince(acceptBaseline), 'org.invite_accepted')?.metadata
    ).toMatchObject({
      actorCredentialType: 'jwt',
      emailHash: expect.any(String),
      pinoEvent: 'org.invite.accepted',
      roleId: expect.any(String),
    })
    expect(JSON.stringify(await auditRowsSince(createBaseline))).not.toContain(
      'invitee@example.com'
    )
    expect(JSON.stringify(await auditRowsSince(acceptBaseline))).not.toContain(seeded.rawToken)
  })

  it('fails closed for transactional audit writes', async () => {
    const auth = await register('tx-fail@example.com')
    const organizationId = await createOrganization(auth.token)
    const baseline = await prisma.auditLog.count()
    await blockAuditInserts()

    await request(app.getHttpServer())
      .post('/api-keys')
      .set('Authorization', `Bearer ${auth.token}`)
      .send({ name: 'Should Fail', organizationId, scopes: ['read:User'] })
      .expect(500)

    expect(await prisma.apiKey.count()).toBe(0)
    expect(await auditRowsSince(baseline)).toHaveLength(0)
  })

  it('keeps best-effort actions successful when audit persistence fails', async () => {
    const admin = await register('best-effort@example.com')
    const orgId = await createOrganization(admin.token)
    const orgToken = await switchOrganization(admin.token, orgId)
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/members/invite`)
      .set('Authorization', `Bearer ${orgToken}`)
      .send({ email: 'pending@example.com' })
      .expect(202)

    const invite = await prisma.orgInvite.findFirstOrThrow({
      where: { organizationId: orgId, emailCanonical: 'pending@example.com' },
      select: { id: true, revokedAt: true },
    })
    const baseline = await prisma.auditLog.count()
    await blockAuditInserts()

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/invites/${invite.id}`)
      .set('Authorization', `Bearer ${orgToken}`)
      .expect(204)

    const revoked = await prisma.orgInvite.findUniqueOrThrow({
      where: { id: invite.id },
      select: { revokedAt: true },
    })
    expect(revoked.revokedAt).not.toBeNull()
    expect(await auditRowsSince(baseline)).toHaveLength(0)
  })

  async function register(email: string, password = 'StrongP@ss123') {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201)
    return { token: res.body.accessToken as string, userId: res.body.user.id as string }
  }

  async function createOrganization(token: string) {
    const res = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Corp' })
      .expect(201)
    return res.body.id as string
  }

  async function switchOrganization(token: string, orgId: string) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/switch`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    return res.body.accessToken as string
  }

  async function promoteAndStepUp(auth: { token: string; userId: string }) {
    await prisma.user.update({
      where: { id: auth.userId },
      data: { systemRole: 'SUPER_ADMIN' },
    })
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'superadmin@example.com', password: 'StrongP@ss123' })
      .expect(200)
    const stepUp = await request(app.getHttpServer())
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${login.body.accessToken as string}`)
      .send({ password: 'StrongP@ss123' })
      .expect(200)
    return stepUp.body.accessToken as string
  }

  async function auditRowsSince(baseline: number) {
    return prisma.auditLog.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: baseline,
    })
  }

  async function seedInvite(orgId: string, invitedById: string, email: string) {
    const rawToken = randomBytes(32).toString('base64url')
    await prisma.orgInvite.create({
      data: {
        organizationId: orgId,
        email,
        emailCanonical: email,
        invitedById,
        roleId: null,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    return { rawToken }
  }

  async function blockAuditInserts() {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS audit_log_test_block_insert ON core.audit_log'
    )
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS core.reject_test_audit_insert()')
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION core.reject_test_audit_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'audit insert blocked';
      END;
      $$;
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER audit_log_test_block_insert
      BEFORE INSERT ON core.audit_log
      FOR EACH ROW
      EXECUTE FUNCTION core.reject_test_audit_insert()
    `)
  }

  async function unblockAuditInserts() {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS audit_log_test_block_insert ON core.audit_log'
    )
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS core.reject_test_audit_insert()')
  }
})

function findAudit(rows: Array<{ action: string; metadata: unknown }>, action: string) {
  return rows.find((row) => row.action === action)
}
