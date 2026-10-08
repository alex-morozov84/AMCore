import { createHash, randomBytes } from 'node:crypto'

import { JwtService } from '@nestjs/jwt'
import { Pool } from 'pg'
import request from 'supertest'

import { createInvitationOperationId, type RequestPrincipal, SystemRole } from '@amcore/shared'

import { invitationActor } from '../src/core/organizations/invitation-actor'
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
            ? { deletion: 409, member: 1, roles: 1, refused: false as string | boolean }
            : { deletion: 200, member: 0, roles: 0, refused: 'INVITE_INVALID_OR_EXPIRED' }
        expect({
          deletion: deletion.status,
          member,
          roles,
          refused: (acceptance as { errorCode?: string })?.errorCode ?? false,
        }).toEqual(expected)
      } finally {
        hold.restore()
      }
    }
  )

  /** Audit rows of this test's organization only (the audit table is not reset between cases). */
  const auditCount = async (action: string, source?: string): Promise<number> =>
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM core.audit_log
          WHERE action = $1 AND "organizationId" = $2 AND ($3::text IS NULL OR metadata->>'source' = $3)`,
        [action, orgId, source ?? null]
      )
    ).rows[0].n as number
  const ownerPrincipal = (): RequestPrincipal => {
    const owner = context.app.get(JwtService).verify(token)
    return {
      type: 'jwt',
      sub: owner.sub,
      email: owner.email,
      systemRole: SystemRole.User,
      organizationId: orgId,
      aclVersion: 0,
    }
  }
  const inviteActor = () => {
    const principal = ownerPrincipal() // the admission must carry the very same object
    return invitationActor({
      user: principal,
      privilegedAdmission: { authenticated: principal, principal },
    })
  }
  const replacement = async (roleIds: string[]) => ({
    expectedMemberId: memberId,
    expectedAclVersion: (
      await auth(http().get(`/organizations/${orgId}/members/${memberUserId}/roles`)).expect(200)
    ).body.aclVersion,
    roleIds,
  })
  const replaceRoles = (body: object) =>
    auth(http().patch(`/organizations/${orgId}/members/${memberUserId}/roles`).send(body)).then(
      (r) => r
    )
  const saveDefinition = (
    roleId: string,
    d: Parameters<typeof definition>[0],
    presets: object[] = [],
    bearer = token
  ) =>
    http()
      .patch(`${base()}/${roleId}`)
      .auth(bearer, { type: 'bearer' })
      .send(definition(d, presets))
      .then((r) => r)
  const deleteRole = (roleId: string, body: object, bearer = token) =>
    http()
      .post(`${base()}/${roleId}/deletion`)
      .auth(bearer, { type: 'bearer' })
      .send(body)
      .then((r) => r)

  it('member role replacement in flight, then an editor save from the old revision: the save waits, then conflicts without a change', async () => {
    const role = await create('Order H')
    const current = await detail(role.role.id)
    const body = await replacement([memberRoleId, role.role.id])
    const hold = holdAudit(context, (e) => e.action === 'org.member_roles_changed')
    let saved: Promise<request.Response> | undefined
    try {
      const replace = replaceRoles(body)
      await hold.entered
      saved = saveDefinition(role.role.id, current, [
        { capabilityId: 'organization.read', presetId: 'own' },
      ])
      await waitForDbBlock(pool)
      hold.release()
      const [r, s] = await Promise.all([replace, saved])
      expect([r.status, s.status]).toEqual([200, 409])
      expect(s.body.errorCode).toBe('ROLE_DEFINITION_CONFLICT')
    } finally {
      hold.restore()
      await Promise.allSettled(saved ? [saved] : [])
    }
    const after = await detail(role.role.id)
    expect(after).toMatchObject({ ruleCount: 0, managedPresets: [], holders: { total: 1 } })
    expect(await prisma.memberRole.count({ where: { memberId, roleId: role.role.id } })).toBe(1)
    expect(await auditCount('org.role_updated')).toBe(0)
  })

  it('role delete in flight, then a member replacement from the old revision: the replacement waits, then conflicts and nothing is resurrected', async () => {
    const role = await create('Order I')
    const before = await detail(role.role.id)
    const body = await replacement([memberRoleId, role.role.id])
    const hold = holdAudit(context, (e) => e.action === 'org.role_deleted')
    let replace: Promise<request.Response> | undefined
    try {
      const removal = deleteRole(role.role.id, {
        expectedAclVersion: before.aclVersion,
        expectedLiveInvitationCount: 0,
      })
      await hold.entered
      replace = replaceRoles(body)
      await waitForDbBlock(pool)
      hold.release()
      const [d, r] = await Promise.all([removal, replace])
      expect([d.status, r.status]).toEqual([200, 409])
      expect(r.body.errorCode).toBe('MEMBER_ROLES_CONFLICT')
    } finally {
      hold.restore()
      await Promise.allSettled(replace ? [replace] : [])
    }
    expect(await prisma.role.count({ where: { id: role.role.id } })).toBe(0)
    expect(await prisma.memberRole.count({ where: { memberId, roleId: role.role.id } })).toBe(0)
  })

  it('legacy member assignment in flight, then a role delete from the old revision: the delete waits, then conflicts and the holder survives', async () => {
    const role = await create('Order J')
    const before = await detail(role.role.id)
    const hold = holdAudit(context, (e) => e.action === 'org.member_roles_changed')
    let removal: Promise<request.Response> | undefined
    try {
      const assign = auth(
        http().post(`/organizations/${orgId}/members/${memberUserId}/roles/${role.role.id}`)
      ).then((r) => r)
      await hold.entered
      removal = deleteRole(role.role.id, {
        expectedAclVersion: before.aclVersion,
        expectedLiveInvitationCount: 0,
      })
      await waitForDbBlock(pool)
      hold.release()
      const [a, d] = await Promise.all([assign, removal])
      expect([a.status, d.status]).toEqual([204, 409])
      expect(d.body.errorCode).toBe('ROLE_DEFINITION_CONFLICT')
    } finally {
      hold.restore()
      await Promise.allSettled(removal ? [removal] : [])
    }
    expect((await detail(role.role.id)).holders.total).toBe(1)
  })

  it('two editor saves from one revision serialize behind a real barrier: exactly one commits, the stale one conflicts', async () => {
    const role = await create('Order K')
    const current = await detail(role.role.id)
    const rev = await revision()
    const hold = holdAudit(context, (e) => editorEvent(e, 'editor'))
    let second: Promise<request.Response> | undefined
    try {
      const first = saveDefinition(role.role.id, {
        ...current,
        role: { ...current.role, name: 'Order K one' },
      })
      await hold.entered
      second = saveDefinition(role.role.id, {
        ...current,
        role: { ...current.role, name: 'Order K two' },
      })
      await waitForDbBlock(pool)
      hold.release()
      const [a, b] = await Promise.all([first, second])
      expect([a.status, b.status]).toEqual([200, 409])
      expect(b.body.errorCode).toBe('ROLE_DEFINITION_CONFLICT')
    } finally {
      hold.restore()
      await Promise.allSettled(second ? [second] : [])
    }
    expect(await revision()).toBe(rev + 1)
    expect((await detail(role.role.id)).role.name).toBe('Order K one')
    expect(await auditCount('org.role_updated', 'editor')).toBe(1)
  })

  it.each([
    ['create then create', 'create-first'],
    ['rename then create', 'rename-first'],
  ] as const)(
    'competing for one name (%s): the loser gets a stable name conflict and no duplicate or stray event',
    async (_label, order) => {
      const role = await create('Seed name')
      const current = await detail(role.role.id)
      const createdBefore = await auditCount('org.role_created')
      const hold = holdAudit(context, (e) =>
        order === 'create-first' ? e.action === 'org.role_created' : editorEvent(e, 'editor')
      )
      let second: Promise<request.Response> | undefined
      try {
        const first =
          order === 'create-first'
            ? auth(http().post(base()).send({ name: 'Contested' })).then((r) => r)
            : saveDefinition(role.role.id, {
                ...current,
                role: { ...current.role, name: 'Contested' },
              })
        await hold.entered
        second = auth(http().post(base()).send({ name: 'contested' })).then((r) => r)
        await waitForDbBlock(pool)
        hold.release()
        const [a, b] = await Promise.all([first, second])
        expect([a.status, b.status]).toEqual([order === 'create-first' ? 201 : 200, 409])
        expect(b.body.errorCode).toBe('ROLE_NAME_CONFLICT')
      } finally {
        hold.restore()
        await Promise.allSettled(second ? [second] : [])
      }
      expect(
        await prisma.role.count({
          where: { organizationId: orgId, name: { equals: 'contested', mode: 'insensitive' } },
        })
      ).toBe(1)
      expect(await auditCount('org.role_created')).toBe(
        createdBefore + (order === 'create-first' ? 1 : 0)
      )
    }
  )

  it('create in flight, then a rename from the old revision: the rename waits and conflicts, no duplicate', async () => {
    const role = await create('Order L')
    const current = await detail(role.role.id)
    const hold = holdAudit(context, (e) => e.action === 'org.role_created')
    let rename: Promise<request.Response> | undefined
    try {
      const creating = auth(http().post(base()).send({ name: 'Order L other' })).then((r) => r)
      await hold.entered
      rename = saveDefinition(role.role.id, {
        ...current,
        role: { ...current.role, name: 'order l other' },
      })
      await waitForDbBlock(pool)
      hold.release()
      const [c, r] = await Promise.all([creating, rename])
      expect([c.status, r.status]).toEqual([201, 409])
      expect(r.body.errorCode).toBe('ROLE_DEFINITION_CONFLICT')
    } finally {
      hold.restore()
      await Promise.allSettled(rename ? [rename] : [])
    }
    expect((await detail(role.role.id)).role.name).toBe('Order L')
  })

  it.each([
    ['create', 'invite-first'],
    ['create', 'delete-first'],
    ['reissue', 'invite-first'],
    ['reissue', 'delete-first'],
  ] as const)(
    'admitted invitation %s versus role deletion (%s): count fence, role existence and live intent resolution',
    async (kind, order) => {
      const role = await create(`Order M ${kind} ${order}`)
      const email = `fence-${kind}-${order}@example.test`
      const invites = context.app.get(InviteService)
      let existing: { id: string; generation: number } | null = null
      if (kind === 'reissue') {
        await invites.createInvite(
          orgId,
          { email, roleIds: [role.role.id] },
          inviteActor(),
          createInvitationOperationId()
        )
        existing = await prisma.orgInvite.findFirstOrThrow({
          where: { organizationId: orgId, emailCanonical: email },
          select: { id: true, generation: true },
        })
      }
      const before = await detail(role.role.id)
      const invite = (): Promise<string> =>
        (existing
          ? invites.reissueInvite(
              orgId,
              existing.id,
              { mode: 'replace', expectedGeneration: existing.generation, roleIds: [role.role.id] },
              inviteActor(),
              createInvitationOperationId()
            )
          : invites.createInvite(
              orgId,
              { email, roleIds: [role.role.id] },
              inviteActor(),
              createInvitationOperationId()
            )
        ).then(
          () => 'ok',
          () => 'rejected'
        )
      const remove = (): Promise<request.Response> =>
        deleteRole(role.role.id, {
          expectedAclVersion: before.aclVersion,
          expectedLiveInvitationCount: before.impact.liveInvitationCount,
        })
      const hold = holdAudit(context, (e) =>
        order === 'invite-first'
          ? e.action === (kind === 'create' ? 'org.invite_created' : 'org.invite_reissued')
          : e.action === 'org.role_deleted'
      )
      let second: Promise<unknown> | undefined
      let first: Promise<unknown> | undefined
      try {
        first = order === 'invite-first' ? invite() : remove()
        await hold.entered
        second = order === 'invite-first' ? remove() : invite()
        await waitForDbBlock(pool)
        hold.release()
        const [one, two] = await Promise.all([first, second])
        const inviteResult = (order === 'invite-first' ? one : two) as string
        const deletion = (order === 'invite-first' ? two : one) as request.Response
        const intents = await pool.query(
          `SELECT ri."liveRoleId" FROM core.org_invite_role_intents ri JOIN core.org_invites i ON i.id = ri."inviteId" WHERE i."organizationId" = $1 AND i."emailCanonical" = $2`,
          [orgId, email]
        )
        const roleExists = await prisma.role.count({ where: { id: role.role.id } })
        // create+invite-first: the new invitation raises the live count, so the stale confirmation (0) is
        // refused and the role keeps its live intent. reissue+invite-first: the same invitation is replaced,
        // so the count is unchanged and the delete commits and nulls the intent. delete-first: the invitation
        // command is refused and every existing intent no longer resolves to the deleted role.
        const expected = {
          'create:invite-first': { invite: 'ok', deletion: 409, role: 1, liveIntents: 1 },
          'create:delete-first': { invite: 'rejected', deletion: 200, role: 0, liveIntents: 0 },
          'reissue:invite-first': { invite: 'ok', deletion: 200, role: 0, liveIntents: 0 },
          'reissue:delete-first': { invite: 'rejected', deletion: 200, role: 0, liveIntents: 0 },
        }[`${kind}:${order}` as const]
        expect({
          invite: inviteResult,
          deletion: deletion.status,
          role: roleExists,
          liveIntents: intents.rows.filter((row) => row.liveRoleId !== null).length,
        }).toEqual(expected)
      } finally {
        hold.restore()
        await Promise.allSettled([first, second].filter(Boolean) as Promise<unknown>[])
      }
    }
  )

  it('a removed and rejoined editor cannot save with a stale revision, and cannot save at all while removed', async () => {
    const actor = await register('editor@example.test')
    const actorId = context.app.get(JwtService).verify(actor.accessToken).sub
    const control = await prisma.role.create({
      data: { name: 'Role editors', organizationId: orgId, isSystem: false },
    })
    await prisma.permission.create({
      data: {
        id: 'editor-ta',
        action: 'manage',
        subject: 'TeamAccess',
        fields: [],
        inverted: false,
        organizationId: orgId,
      },
    })
    await prisma.rolePermission.create({ data: { roleId: control.id, permissionId: 'editor-ta' } })
    const joined = await seedOrgMember(prisma, { orgId, userId: actorId, roleId: control.id })
    const role = await create('Order N')
    const stale = await detail(role.role.id)
    await saveDefinition(role.role.id, stale, [], actor.accessToken).then((r) =>
      expect(r.status).toBe(200)
    )
    // Removed: the same token no longer has membership, so nothing is written.
    await prisma.orgMember.delete({ where: { id: joined.memberId } })
    await prisma.organization.update({
      where: { id: orgId },
      data: { aclVersion: { increment: 1 } },
    })
    const rev = await revision()
    await saveDefinition(role.role.id, { ...stale, aclVersion: rev }, [], actor.accessToken).then(
      (r) => expect([403, 404]).toContain(r.status)
    )
    expect(await revision()).toBe(rev)
    // Rejoined: a new membership; the draft read before removal is stale and conflicts.
    await seedOrgMember(prisma, { orgId, userId: actorId, roleId: control.id })
    await saveDefinition(
      role.role.id,
      stale,
      [{ capabilityId: 'organization.read', presetId: 'own' }],
      actor.accessToken
    ).then((r) => {
      expect(r.status).toBe(409)
      expect(r.body.errorCode).toBe('ROLE_DEFINITION_CONFLICT')
    })
    const fresh = await detail(role.role.id)
    await saveDefinition(
      role.role.id,
      fresh,
      [{ capabilityId: 'organization.read', presetId: 'own' }],
      actor.accessToken
    ).then((r) => expect(r.status).toBe(200))
  })

  it('a stale self-held draft is refused after the actor lost the role, and then needs no acknowledgment', async () => {
    const role = await create('Order O')
    const owner = await prisma.orgMember.findFirstOrThrow({
      where: { organizationId: orgId, userId: ownerPrincipal().sub },
    })
    await prisma.memberRole.create({ data: { memberId: owner.id, roleId: role.role.id } })
    await prisma.organization.update({
      where: { id: orgId },
      data: { aclVersion: { increment: 1 } },
    })
    const held = await detail(role.role.id)
    expect(held.selfHeld).toBe(true)
    // Someone removes the actor's hold after the draft was read.
    await auth(
      http().delete(`/organizations/${orgId}/members/${ownerPrincipal().sub}/roles/${role.role.id}`)
    ).expect(204)
    const rev = await revision()
    await http()
      .patch(`${base()}/${role.role.id}`)
      .auth(token, { type: 'bearer' })
      .send({
        ...definition(held, [{ capabilityId: 'organization.read', presetId: 'own' }]),
        acknowledgeSelfHeld: true,
      })
      .expect(409)
      .then((r) => expect(r.body.errorCode).toBe('ROLE_DEFINITION_CONFLICT'))
    expect(await revision()).toBe(rev)
    const fresh = await detail(role.role.id)
    expect(fresh.selfHeld).toBe(false)
    await saveDefinition(role.role.id, fresh, [
      { capabilityId: 'organization.read', presetId: 'own' },
    ]).then((r) => expect(r.status).toBe(200))
  })

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
