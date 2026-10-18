import { createHash, randomBytes } from 'node:crypto'

import { JwtService } from '@nestjs/jwt'
import { Pool } from 'pg'
import request from 'supertest'

import { SystemRole } from '@amcore/shared'

import { AuditLogService } from '../src/core/audit'
import { InviteService } from '../src/core/organizations/invite.service'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedOrgMember,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'
import { acceptInvitationForTest, invitationSeedRole } from './helpers/invitation-contract'
import { holdMemberTransaction, waitForDbBlock } from './helpers/organization-members-race'
const jest = import.meta.jest

describe('Organization member credential control (real DB)', () => {
  let pool: Pool
  let c: E2ETestContext
  let admin: string, memberToken: string, orgId: string, userId: string, memberId: string
  const http = () => c.app.getHttpServer()
  const base = () => `/organizations/${orgId}/members/${userId}/api-keys`
  beforeAll(async () => {
    c = await setupE2ETest()
    pool = new Pool({ connectionString: c.postgresContainer.getConnectionUri() })
    await seedSystemRoles(c.prisma)
  }, 120000)
  afterAll(async () => {
    await pool?.end()
    if (c) await teardownE2ETest(c)
  }, 120000)
  beforeEach(async () => {
    await cleanOrgData(c.prisma)
    await cleanDatabase(c.prisma, c.cache, c.throttlerStorage)
    admin = (
      await request(http())
        .post('/auth/register')
        .send({ email: 'keys-admin@example.test', password: 'StrongP@ss123' })
        .expect(201)
    ).body.accessToken
    orgId = (
      await request(http())
        .post('/organizations')
        .auth(admin, { type: 'bearer' })
        .send({ name: 'Key control' })
        .expect(201)
    ).body.id
    memberToken = (
      await request(http())
        .post('/auth/register')
        .send({ email: 'keys-member@example.test', password: 'StrongP@ss123' })
        .expect(201)
    ).body.accessToken
    userId = c.app.get(JwtService).verify(memberToken).sub
    const role = await c.prisma.role.findFirstOrThrow({ where: { name: 'MEMBER', isSystem: true } })
    memberId = (await seedOrgMember(c.prisma, { orgId, userId, roleId: role.id })).memberId
  })
  const create = async () =>
    (
      await request(http())
        .post('/api-keys')
        .auth(memberToken, { type: 'bearer' })
        .send({ name: 'Worker integration', organizationId: orgId, scopes: ['read:Organization'] })
        .expect(201)
    ).body
  const read = () =>
    request(http())
      .get(base())
      .query({ expectedMemberId: memberId })
      .auth(admin, { type: 'bearer' })
  const revoke = (keyId?: string) =>
    request(http())
      .post(`${base()}/${keyId ? `${keyId}/revoke` : 'revoke-all'}`)
      .auth(admin, { type: 'bearer' })
      .send({ expectedMemberId: memberId })

  it('safe snapshot and explicit idempotent single revoke retain first audit and verifier destruction', async () => {
    const key = await create()
    const list = await read().expect(200)
    expect(list.body).toMatchObject({ total: 1, revocableCount: 1, member: { memberId, userId } })
    for (const secret of [key.key, 'keyHash', 'shortToken', 'salt'])
      expect(JSON.stringify(list.body)).not.toContain(secret)
    await revoke(key.id)
      .expect(200)
      .expect((r) => expect(r.body.affectedCount).toBe(1))
    const first = await c.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })
    expect(first).toMatchObject({
      keyHash: null,
      salt: null,
      revocationReason: 'organization_admin_revoked',
    })
    await revoke(key.id)
      .expect(200)
      .expect((r) => expect(r.body.affectedCount).toBe(0))
    expect((await c.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).toEqual(
      first.revokedAt
    )
    expect(
      await c.prisma.auditLog.count({ where: { action: 'api_key.revoked', targetId: key.id } })
    ).toBe(1)
    await request(http()).get('/auth/me').auth(key.key, { type: 'bearer' }).expect(401)
  })
  it('requires live membership and team authority; keys never manage credentials', async () => {
    const key = await create()
    await request(http())
      .get(base())
      .query({ expectedMemberId: memberId })
      .auth(memberToken, { type: 'bearer' })
      .expect(403)
    for (const operation of ['read', 'single', 'all']) {
      const r =
        operation === 'read'
          ? request(http()).get(base()).query({ expectedMemberId: memberId })
          : request(http())
              .post(`${base()}/${operation === 'single' ? `${key.id}/revoke` : 'revoke-all'}`)
              .send({ expectedMemberId: memberId })
      await r.auth(key.key, { type: 'bearer' }).expect(401)
    }
    await request(http())
      .post(`${base()}/revoke-all`)
      .auth(admin, { type: 'bearer' })
      .send({ expectedMemberId: 'different-member' })
      .expect(409)
  })
  it('rejects foreign key selectors and revokes across pages including expired rows', async () => {
    await create()
    const otherOrg = (
      await request(http())
        .post('/organizations')
        .auth(admin, { type: 'bearer' })
        .send({ name: 'Other' })
        .expect(201)
    ).body.id
    const foreign = (
      await request(http())
        .post('/api-keys')
        .auth(admin, { type: 'bearer' })
        .send({ name: 'Foreign', organizationId: otherOrg, scopes: ['read:Organization'] })
        .expect(201)
    ).body
    await revoke(foreign.id).expect(404)
    await c.prisma.apiKey.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        name: 'Expired integration',
        shortToken: `expired-${i}`,
        keyHash: 'hash',
        salt: 'salt',
        userId,
        organizationId: orgId,
        expiresAt: new Date(Date.now() - 1000),
      })),
    })
    await revoke()
      .expect(200)
      .expect((r) => expect(r.body).toMatchObject({ requestedCount: 26, affectedCount: 26 }))
    expect(
      await c.prisma.apiKey.count({ where: { organizationId: orgId, userId, revokedAt: null } })
    ).toBe(0)
    expect(
      (await c.prisma.apiKey.findUniqueOrThrow({ where: { id: foreign.id } })).revokedAt
    ).toBeNull()
    await revoke()
      .expect(200)
      .expect((r) => expect(r.body.requestedCount).toBe(0))
  })
  it('real deletion revokes keys; recreated membership never restores an old secret', async () => {
    const key = await create()
    await request(http())
      .delete(`/organizations/${orgId}/members/${userId}`)
      .auth(admin, { type: 'bearer' })
      .expect(204)
    expect(await c.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).toMatchObject({
      keyHash: null,
      salt: null,
      revocationReason: 'membership_removed',
    })
    const role = await c.prisma.role.findFirstOrThrow({ where: { name: 'MEMBER', isSystem: true } })
    const rawToken = randomBytes(32).toString('base64url')
    const recipient = c.app.get(JwtService).verify(memberToken)
    await c.prisma.user.update({ where: { id: userId }, data: { emailVerified: true } })
    await c.prisma.orgInvite.create({
      data: {
        organizationId: orgId,
        email: recipient.email,
        emailCanonical: recipient.email,
        ...(await invitationSeedRole(c.prisma, role.id)),
        invitedById: c.app.get(JwtService).verify(admin).sub,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 60000),
      },
    })
    await acceptInvitationForTest(
      c.app.get(InviteService),
      c.prisma,
      rawToken,
      { type: 'jwt', sub: userId, email: recipient.email, systemRole: SystemRole.User },
      '127.0.0.1'
    )
    const joined = await c.prisma.orgMember.findUniqueOrThrow({
      where: { userId_organizationId: { userId, organizationId: orgId } },
    })
    expect(joined.id).not.toBe(memberId)
    await request(http()).get('/auth/me').auth(key.key, { type: 'bearer' }).expect(401)
    await read().expect(409)
  })
  it('1001 refuses all and deletion atomically even when metadata is oversized', async () => {
    await c.prisma.apiKey.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        name: 'Many',
        shortToken: `many-${i}`,
        keyHash: 'hash',
        salt: 'salt',
        userId,
        organizationId: orgId,
        scopes: i === 1000 ? ['x'.repeat(70000)] : [],
      })),
    })
    await read().expect(503)
    await revoke().expect(409)
    await request(http())
      .delete(`/organizations/${orgId}/members/${userId}`)
      .auth(admin, { type: 'bearer' })
      .expect(409)
    expect(await c.prisma.apiKey.count({ where: { organizationId: orgId, revokedAt: null } })).toBe(
      1001
    )
    expect(await c.prisma.orgMember.findUnique({ where: { id: memberId } })).not.toBeNull()
  })
  it('audit failure rolls back key transition, membership and ACL', async () => {
    const key = await create()
    const before = await c.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
    const audit = jest
      .spyOn(c.app.get(AuditLogService), 'record')
      .mockRejectedValueOnce(new Error('Audit unavailable'))
    try {
      await request(http())
        .delete(`/organizations/${orgId}/members/${userId}`)
        .auth(admin, { type: 'bearer' })
        .expect(503)
    } finally {
      audit.mockRestore()
    }
    expect(await c.prisma.orgMember.findUnique({ where: { id: memberId } })).not.toBeNull()
    expect(
      (await c.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).aclVersion
    ).toBe(before.aclVersion)
    expect(
      (await c.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt
    ).toBeNull()
  })
  it('preserves only the original-bound live SUPER_ADMIN legacy deletion exception', async () => {
    const claims = c.app.get(JwtService).verify(admin)
    await c.prisma.user.update({
      where: { id: claims.sub },
      data: { systemRole: SystemRole.SuperAdmin },
    })
    await c.prisma.orgMember.deleteMany({ where: { organizationId: orgId, userId: claims.sub } })
    const { iat: _, exp: __, ...rest } = claims
    const bound = c.app
      .get(JwtService)
      .sign({ ...rest, systemRole: SystemRole.SuperAdmin, organizationId: orgId })
    const personal = c.app.get(JwtService).sign({ ...rest, systemRole: SystemRole.SuperAdmin })
    await request(http())
      .get(base())
      .query({ expectedMemberId: memberId })
      .auth(bound, { type: 'bearer' })
      .expect(403)
    await request(http())
      .delete(`/organizations/${orgId}/members/${userId}`)
      .auth(personal, { type: 'bearer' })
      .expect(403)
    await request(http())
      .delete(`/organizations/${orgId}/members/${userId}`)
      .auth(bound, { type: 'bearer' })
      .expect(204)
  })
  it('live SUPER_ADMIN with membership uses synthetic trust without an org role', async () => {
    const claims = c.app.get(JwtService).verify(admin)
    await c.prisma.user.update({
      where: { id: claims.sub },
      data: { systemRole: SystemRole.SuperAdmin },
    })
    const actorMembership = await c.prisma.orgMember.findUniqueOrThrow({
      where: { userId_organizationId: { userId: claims.sub, organizationId: orgId } },
    })
    await c.prisma.memberRole.deleteMany({ where: { memberId: actorMembership.id } })
    await request(http())
      .get(base())
      .query({ expectedMemberId: memberId })
      .auth(admin, { type: 'bearer' })
      .expect(403)
    const login = await request(http())
      .post('/auth/login')
      .send({ email: claims.email, password: 'StrongP@ss123' })
      .expect(200)
    const key = await create()
    await request(http())
      .get(base())
      .query({ expectedMemberId: memberId })
      .auth(login.body.accessToken, { type: 'bearer' })
      .expect(200)
    await request(http())
      .post(`${base()}/${key.id}/revoke`)
      .send({ expectedMemberId: memberId })
      .auth(login.body.accessToken, { type: 'bearer' })
      .expect(200)
    const operatorKey = (
      await request(http())
        .post('/api-keys')
        .auth(login.body.accessToken, { type: 'bearer' })
        .send({
          name: 'Synthetic owner operator',
          organizationId: orgId,
          scopes: ['manage:TeamAccess'],
        })
        .expect(201)
    ).body
    await request(http())
      .get(base())
      .query({ expectedMemberId: memberId })
      .auth(operatorKey.key, { type: 'bearer' })
      .expect(401)
    await request(http())
      .delete(`/organizations/${orgId}/members/${userId}`)
      .auth(operatorKey.key, { type: 'bearer' })
      .expect(204)
  })
  it.each([
    ['read:Organization', 403],
    ['manage:TeamAccess', 204],
  ] as const)('legacy member DELETE requires exact key scope %s', async (scope, status) => {
    const key = (
      await request(http())
        .post('/api-keys')
        .auth(admin, { type: 'bearer' })
        .send({ name: 'Removal operator', organizationId: orgId, scopes: [scope] })
        .expect(201)
    ).body
    await request(http())
      .delete(`/organizations/${orgId}/members/${userId}`)
      .auth(key.key, { type: 'bearer' })
      .expect(status)
    expect(Boolean(await c.prisma.orgMember.findUnique({ where: { id: memberId } }))).toBe(
      status !== 204
    )
  })
  it('oversized identity refuses inventory while bounded ID revocation still works', async () => {
    const key = await create()
    await c.prisma.user.update({ where: { id: userId }, data: { name: 'x'.repeat(17000) } })
    await read().expect(503)
    await revoke(key.id).expect(200)
  })
  it.each(['create-first', 'all-first', 'remove-first'] as const)(
    'serializes %s with controlled real database barriers',
    async (order) => {
      await create()
      const hold = holdMemberTransaction(c.prisma, false)
      let first: Promise<request.Response> | undefined,
        second: Promise<request.Response> | undefined
      try {
        first =
          order === 'create-first'
            ? create()
            : order === 'all-first'
              ? revoke().then((r) => r)
              : request(http())
                  .delete(`/organizations/${orgId}/members/${userId}`)
                  .auth(admin, { type: 'bearer' })
                  .then((r) => r)
        await hold.entered
        second =
          order === 'create-first'
            ? revoke().then((r) => r)
            : request(http())
                .post('/api-keys')
                .auth(memberToken, { type: 'bearer' })
                .send({ name: 'Late', organizationId: orgId, scopes: ['read:Organization'] })
                .then((r) => r)
        await waitForDbBlock(pool)
        hold.release()
        const [a, b] = await Promise.all([first, second])
        const observed =
          order === 'create-first'
            ? ['id' in a ? typeof a.id : 'undefined', b.body.affectedCount]
            : order === 'all-first'
              ? [a.body.affectedCount, b.status]
              : [a.status, b.status]
        const expected = {
          'create-first': ['string', 2],
          'all-first': [1, 201],
          'remove-first': [204, 403],
        }
        expect(observed).toEqual(expected[order])
        expect(
          await c.prisma.apiKey.count({ where: { organizationId: orgId, userId, revokedAt: null } })
        ).toBe(order === 'all-first' ? 1 : 0)
      } finally {
        hold.restore()
        await Promise.allSettled([...(first ? [first] : []), ...(second ? [second] : [])])
      }
    }
  )
  it('rechecks actor roles after waiting on organization lock', async () => {
    const key = await create()
    const actor = c.app.get(JwtService).verify(admin).sub
    const connection = await pool.connect()
    let pending: Promise<request.Response> | undefined
    try {
      await connection.query('BEGIN')
      await connection.query('SELECT id FROM core.organizations WHERE id=$1 FOR UPDATE', [orgId])
      pending = revoke(key.id).then((r) => r)
      await waitForDbBlock(pool)
      await connection.query(
        'DELETE FROM core.member_roles WHERE "memberId"=(SELECT id FROM core.org_members WHERE "userId"=$1 AND "organizationId"=$2)',
        [actor, orgId]
      )
      await connection.query(
        'UPDATE core.organizations SET "aclVersion"="aclVersion"+1 WHERE id=$1',
        [orgId]
      )
      await connection.query('COMMIT')
      expect((await pending).status).toBe(403)
      expect(
        (await c.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt
      ).toBeNull()
    } finally {
      await connection.query('ROLLBACK')
      connection.release()
      if (pending) await Promise.allSettled([pending])
    }
  })

  it('system demotion while the actor lock is held defeats stale synthetic trust', async () => {
    const claims = c.app.get(JwtService).verify(admin)
    await c.prisma.user.update({
      where: { id: claims.sub },
      data: { systemRole: SystemRole.SuperAdmin },
    })
    const membership = await c.prisma.orgMember.findUniqueOrThrow({
      where: { userId_organizationId: { userId: claims.sub, organizationId: orgId } },
    })
    await c.prisma.memberRole.deleteMany({ where: { memberId: membership.id } })
    const login = await request(http())
      .post('/auth/login')
      .send({ email: claims.email, password: 'StrongP@ss123' })
      .expect(200)
    const connection = await pool.connect()
    let pending: Promise<request.Response> | undefined
    try {
      await connection.query('BEGIN')
      await connection.query('SELECT id FROM core.users WHERE id=$1 FOR UPDATE', [claims.sub])
      pending = request(http())
        .post(`${base()}/revoke-all`)
        .auth(login.body.accessToken, { type: 'bearer' })
        .send({ expectedMemberId: memberId })
        .then((r) => r)
      await waitForDbBlock(pool)
      await connection.query('UPDATE core.users SET "systemRole"=$2 WHERE id=$1', [
        claims.sub,
        'USER',
      ])
      await connection.query('COMMIT')
      expect((await pending).status).toBe(403)
    } finally {
      await connection.query('ROLLBACK')
      connection.release()
      if (pending) await Promise.allSettled([pending])
    }
  })
  it('cleanup between candidate selection and key lock is a bounded all no-op', async () => {
    const key = await create()
    await c.prisma.apiKey.update({
      where: { id: key.id },
      data: { expiresAt: new Date(Date.now() - 31 * 86400000) },
    })
    const connection = await pool.connect()
    let pending: Promise<request.Response> | undefined
    try {
      await connection.query('BEGIN')
      await connection.query('SELECT id FROM core.api_keys WHERE id=$1 FOR UPDATE', [key.id])
      pending = revoke().then((r) => r)
      await waitForDbBlock(pool)
      await connection.query('DELETE FROM core.api_keys WHERE id=$1', [key.id])
      await connection.query('COMMIT')
      const result = await pending
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({ requestedCount: 1, affectedCount: 0 })
      expect(
        await c.prisma.auditLog.count({ where: { action: 'api_key.revoked', targetId: key.id } })
      ).toBe(0)
    } finally {
      await connection.query('ROLLBACK')
      connection.release()
      if (pending) await Promise.allSettled([pending])
    }
  })
  it('last administrator refusal leaves that administrator key usable', async () => {
    const actor = c.app.get(JwtService).verify(admin).sub
    const key = (
      await request(http())
        .post('/api-keys')
        .auth(admin, { type: 'bearer' })
        .send({ name: 'Admin integration', organizationId: orgId, scopes: ['read:Organization'] })
        .expect(201)
    ).body
    await request(http())
      .delete(`/organizations/${orgId}/members/${actor}`)
      .auth(admin, { type: 'bearer' })
      .expect(400)
    expect(
      (await c.prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt
    ).toBeNull()
    await request(http()).get('/auth/me').auth(key.key, { type: 'bearer' }).expect(200)
  })
  it('1000 transitions and their required summary metadata remain atomic and bounded', async () => {
    await c.prisma.apiKey.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({
        name: 'Bounded',
        shortToken: `bounded-${i}`,
        keyHash: 'hash',
        salt: 'salt',
        userId,
        organizationId: orgId,
      })),
    })
    await revoke()
      .expect(200)
      .expect((r) => expect(r.body).toMatchObject({ requestedCount: 1000, affectedCount: 1000 }))
    const summary = await c.prisma.auditLog.findFirstOrThrow({
      where: { action: 'organization.api_keys.revocation_requested', organizationId: orgId },
    })
    expect(summary.metadata).toMatchObject({
      requestedCount: 1000,
      affectedCount: 1000,
      memberId,
      operation: 'all',
      reason: 'organization_admin_revoked',
    })
    expect(
      await c.prisma.auditLog.count({ where: { action: 'api_key.revoked', organizationId: orgId } })
    ).toBe(1000)
  })
})
