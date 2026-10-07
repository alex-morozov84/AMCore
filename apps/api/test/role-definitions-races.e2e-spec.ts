import { createHash, randomBytes } from 'node:crypto'

import { JwtService } from '@nestjs/jwt'
import { Pool } from 'pg'
import request from 'supertest'

import { SystemRole } from '@amcore/shared'

import { InviteService } from '../src/core/organizations/invite.service'
import type { PrismaService } from '../src/prisma'

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
import { waitForDbBlock } from './helpers/organization-members-race'
import { holdAudit } from './helpers/role-definition-race'

/**
 * Barrier-based proofs (no sleeps): one real command is paused inside its transaction while it holds
 * the organization lock, a competing real request is proven blocked by the database, then released.
 */
describe('Role definitions: lock ordering and races (real DB)', () => {
  let context: E2ETestContext
  let prisma: PrismaService
  let pool: Pool
  let token: string
  let orgId: string
  let memberUserId: string
  let memberId: string
  let memberRoleId: string

  beforeAll(async () => {
    context = await setupE2ETest()
    prisma = context.prisma
    await seedSystemRoles(prisma)
    pool = new Pool({ connectionString: context.postgresContainer.getConnectionUri() })
  }, 120000)
  afterAll(async () => {
    await pool?.end()
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanOrgData(prisma)
    await cleanDatabase(prisma, context.cache, context.throttlerStorage)
    token = (await register('owner@example.test')).accessToken
    orgId = (
      await http()
        .post('/organizations')
        .auth(token, { type: 'bearer' })
        .send({ name: 'Race lab' })
        .expect(201)
    ).body.id
    const member = await register('member@example.test')
    memberUserId = context.app.get(JwtService).verify(member.accessToken).sub
    memberRoleId = (
      await prisma.role.findFirstOrThrow({ where: { name: 'MEMBER', isSystem: true } })
    ).id
    memberId = (await seedOrgMember(prisma, { orgId, userId: memberUserId, roleId: memberRoleId }))
      .memberId
  })

  const http = () => request(context.app.getHttpServer())
  async function register(email: string): Promise<{ accessToken: string }> {
    return (
      await http().post('/auth/register').send({ email, password: 'StrongP@ss123' }).expect(201)
    ).body
  }
  const base = () => `/organizations/${orgId}/role-definitions`
  const auth = (test: request.Test) => test.auth(token, { type: 'bearer' })
  const detail = async (roleId: string) =>
    (await auth(http().get(`${base()}/${roleId}`)).expect(200)).body
  const create = async (name: string) =>
    (await auth(http().post(base()).send({ name })).expect(201)).body
  const definition = (
    d: { role: { name: string; description: string | null }; aclVersion: number },
    presets: object[] = []
  ) => ({
    expectedAclVersion: d.aclVersion,
    name: d.role.name,
    description: d.role.description,
    presets,
  })
  const revision = async (): Promise<number> =>
    (await pool.query('SELECT "aclVersion" FROM core.organizations WHERE id=$1', [orgId])).rows[0]
      .aclVersion
  const legacyRule = { action: 'read', subject: 'User', conditions: { id: 'x' }, fields: [] }
  const editorEvent = (
    entry: { action: string; metadata?: Record<string, unknown> },
    source: string
  ) => entry.action === 'org.role_updated' && entry.metadata?.source === source

  it('editor save in flight, then a legacy rule write: the legacy writer waits and both commit in order', async () => {
    const role = await create('Order A')
    const current = await detail(role.role.id)
    const rev = await revision()
    const hold = holdAudit(context, (e) => editorEvent(e, 'editor'))
    try {
      const saved = auth(
        http()
          .patch(`${base()}/${role.role.id}`)
          .send(definition(current, [{ capabilityId: 'organization.read', presetId: 'own' }]))
      ).then((r) => r)
      await hold.entered
      const legacy = auth(
        http().post(`/organizations/${orgId}/roles/${role.role.id}/permissions`).send(legacyRule)
      ).then((r) => r)
      await waitForDbBlock(pool)
      hold.release()
      const [a, b] = await Promise.all([saved, legacy])
      expect([a.status, b.status]).toEqual([200, 201])
    } finally {
      hold.restore()
    }
    expect(await revision()).toBe(rev + 2)
    expect((await detail(role.role.id)).ruleCount).toBe(2)
  })

  it('legacy rule write in flight, then an editor save from the old revision: the save waits, then conflicts', async () => {
    const role = await create('Order B')
    const current = await detail(role.role.id)
    const hold = holdAudit(context, (e) => editorEvent(e, 'legacy'))
    try {
      const legacy = auth(
        http().post(`/organizations/${orgId}/roles/${role.role.id}/permissions`).send(legacyRule)
      ).then((r) => r)
      await hold.entered
      const saved = auth(
        http()
          .patch(`${base()}/${role.role.id}`)
          .send(definition(current, [{ capabilityId: 'organization.read', presetId: 'own' }]))
      ).then((r) => r)
      await waitForDbBlock(pool)
      hold.release()
      const [l, s] = await Promise.all([legacy, saved])
      expect(l.status).toBe(201)
      expect(s.status).toBe(409)
      expect(s.body.errorCode).toBe('ROLE_DEFINITION_CONFLICT')
    } finally {
      hold.restore()
    }
    const after = await detail(role.role.id)
    expect(after.managedPresets).toEqual([])
    expect(after.advancedRules).toHaveLength(1)
  })

  it('editor save in flight, then a member role replacement from the old revision: it waits, then conflicts', async () => {
    const role = await create('Order C')
    const current = await detail(role.role.id)
    const snapshot = (
      await auth(http().get(`/organizations/${orgId}/members/${memberUserId}/roles`)).expect(200)
    ).body
    const hold = holdAudit(context, (e) => editorEvent(e, 'editor'))
    try {
      const saved = auth(
        http()
          .patch(`${base()}/${role.role.id}`)
          .send(definition(current, [{ capabilityId: 'organization.read', presetId: 'own' }]))
      ).then((r) => r)
      await hold.entered
      const replace = auth(
        http()
          .patch(`/organizations/${orgId}/members/${memberUserId}/roles`)
          .send({
            expectedMemberId: memberId,
            expectedAclVersion: snapshot.aclVersion,
            roleIds: [memberRoleId, role.role.id],
          })
      ).then((r) => r)
      await waitForDbBlock(pool)
      hold.release()
      const [s, r] = await Promise.all([saved, replace])
      expect(s.status).toBe(200)
      expect(r.status).toBe(409)
      expect(r.body.errorCode).toBe('MEMBER_ROLES_CONFLICT')
    } finally {
      hold.restore()
    }
    expect(await prisma.memberRole.count({ where: { memberId, roleId: role.role.id } })).toBe(0)
  })

  it('member role replacement in flight, then a role delete from the old revision: delete waits, then conflicts and the role keeps its holder', async () => {
    const role = await create('Order D')
    const before = await detail(role.role.id)
    const snapshot = (
      await auth(http().get(`/organizations/${orgId}/members/${memberUserId}/roles`)).expect(200)
    ).body
    const hold = holdAudit(context, (e) => e.action === 'org.member_roles_changed')
    try {
      const replace = auth(
        http()
          .patch(`/organizations/${orgId}/members/${memberUserId}/roles`)
          .send({
            expectedMemberId: memberId,
            expectedAclVersion: snapshot.aclVersion,
            roleIds: [memberRoleId, role.role.id],
          })
      ).then((r) => r)
      await hold.entered
      const removal = auth(
        http()
          .post(`${base()}/${role.role.id}/deletion`)
          .send({ expectedAclVersion: before.aclVersion, expectedLiveInvitationCount: 0 })
      ).then((r) => r)
      await waitForDbBlock(pool)
      hold.release()
      const [r, d] = await Promise.all([replace, removal])
      expect(r.status).toBe(200)
      expect(d.status).toBe(409)
      expect(d.body.errorCode).toBe('ROLE_DEFINITION_CONFLICT')
    } finally {
      hold.restore()
    }
    expect((await detail(role.role.id)).holders.total).toBe(1)
  })

  it('role delete in flight, then a legacy member assignment of that role: it waits, then the role is gone', async () => {
    const role = await create('Order E')
    const before = await detail(role.role.id)
    const hold = holdAudit(context, (e) => e.action === 'org.role_deleted')
    try {
      const removal = auth(
        http()
          .post(`${base()}/${role.role.id}/deletion`)
          .send({ expectedAclVersion: before.aclVersion, expectedLiveInvitationCount: 0 })
      ).then((r) => r)
      await hold.entered
      const assign = auth(
        http().post(`/organizations/${orgId}/members/${memberUserId}/roles/${role.role.id}`)
      ).then((r) => r)
      await waitForDbBlock(pool)
      hold.release()
      const [d, a] = await Promise.all([removal, assign])
      expect(d.status).toBe(200)
      expect([403, 404]).toContain(a.status)
    } finally {
      hold.restore()
    }
    expect(await prisma.memberRole.count({ where: { memberId, roleId: role.role.id } })).toBe(0)
    expect(await prisma.role.count({ where: { id: role.role.id } })).toBe(0)
  })

  it.each(['accept-first', 'delete-first'] as const)(
    'role delete and invitation acceptance share the parent lock (%s)',
    async (order) => {
      const role = await create('Order G')
      const registered = await register('invitee@example.test')
      const invitee = context.app.get(JwtService).verify(registered.accessToken)
      await prisma.user.update({ where: { id: invitee.sub }, data: { emailVerified: true } })
      const rawToken = randomBytes(32).toString('base64url')
      await prisma.orgInvite.create({
        data: {
          organizationId: orgId,
          email: invitee.email,
          emailCanonical: invitee.email,
          ...(await invitationSeedRole(prisma, role.role.id)),
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
      const before = await detail(role.role.id)
      const accept = (): Promise<unknown> =>
        acceptInvitationForTest(
          context.app.get(InviteService),
          prisma,
          rawToken,
          { type: 'jwt', sub: invitee.sub, email: invitee.email, systemRole: SystemRole.User },
          '127.0.0.1'
        ).catch((error: unknown) => error)
      const remove = () =>
        auth(
          http()
            .post(`${base()}/${role.role.id}/deletion`)
            .send({ expectedAclVersion: before.aclVersion, expectedLiveInvitationCount: 1 })
        ).then((r) => r)
      const hold = holdAudit(context, (e) =>
        order === 'accept-first'
          ? e.action === 'org.invite_accepted'
          : e.action === 'org.role_deleted'
      )
      try {
        const first = order === 'accept-first' ? accept() : remove()
        await hold.entered
        const second = order === 'accept-first' ? remove() : accept()
        await waitForDbBlock(pool)
        hold.release()
        const [one, two] = await Promise.all([first, second])
        const deletion = (order === 'accept-first' ? two : one) as request.Response
        const acceptance = order === 'accept-first' ? one : two
        const member = await prisma.orgMember.count({
          where: { userId: invitee.sub, organizationId: orgId },
        })
        const roles = await prisma.role.count({ where: { id: role.role.id } })
        // Accepted first: the invite is consumed, so the confirmed impact is stale and the role stays.
        // Deleted first: the issued intent no longer resolves, acceptance is refused, no membership.
        const expected =
          order === 'accept-first'
            ? { deletion: 409, member: 1, roles: 1, refused: false }
            : { deletion: 200, member: 0, roles: 0, refused: true }
        expect({
          deletion: deletion.status,
          member,
          roles,
          refused: acceptance instanceof Error,
        }).toEqual(expected)
      } finally {
        hold.restore()
      }
    }
  )

  it('an invitation issued or expired after the impact was read changes the confirmed count', async () => {
    const role = await create('Order F')
    const first = await detail(role.role.id)
    expect(first.impact.liveInvitationCount).toBe(0)
    const invite = await prisma.orgInvite.create({
      data: {
        organizationId: orgId,
        emailCanonical: 'late@example.test',
        email: 'late@example.test',
        tokenHash: randomBytes(16).toString('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
        roleIntents: {
          create: [
            {
              ordinal: 0,
              requestedRoleId: role.role.id,
              liveRoleId: role.role.id,
              roleNameAtIssue: 'Order F',
            },
          ],
        },
      },
    })
    // Issued between the read and the delete: the stale confirmation (0) is refused.
    await auth(
      http()
        .post(`${base()}/${role.role.id}/deletion`)
        .send({ expectedAclVersion: first.aclVersion, expectedLiveInvitationCount: 0 })
    )
      .expect(409)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_DELETE_IMPACT_CHANGED'))
    const second = await detail(role.role.id)
    expect(second.impact.liveInvitationCount).toBe(1)
    // The same invitation expires after the read: its count changes without any revision bump.
    await prisma.orgInvite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await auth(
      http()
        .post(`${base()}/${role.role.id}/deletion`)
        .send({ expectedAclVersion: second.aclVersion, expectedLiveInvitationCount: 1 })
    )
      .expect(409)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_DELETE_IMPACT_CHANGED'))
    const third = await detail(role.role.id)
    expect(third.impact.liveInvitationCount).toBe(0)
    await auth(
      http()
        .post(`${base()}/${role.role.id}/deletion`)
        .send({ expectedAclVersion: third.aclVersion, expectedLiveInvitationCount: 0 })
    ).expect(200)
  })
})
