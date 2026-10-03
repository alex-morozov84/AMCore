import { createHash, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'

import { JwtService } from '@nestjs/jwt'
import { Pool } from 'pg'
import request from 'supertest'

import { Action, type RequestPrincipal, Subject, SystemRole } from '@amcore/shared'

import { AuditLogService } from '../src/core/audit'
import { InviteService } from '../src/core/organizations/invite.service'
import { MemberService } from '../src/core/organizations/member.service'
import { MemberQueryService } from '../src/core/organizations/member-query.service'
import { MemberRoleSetService } from '../src/core/organizations/member-role-set.service'
import { RoleService } from '../src/core/organizations/role.service'
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
import { holdMemberTransaction, waitForDbBlock } from './helpers/organization-members-race'
const jest = import.meta.jest

describe('Organization member reads and atomic role set (real DB)', () => {
  let context: E2ETestContext
  let prisma: PrismaService
  let pool: Pool
  let token: string
  let orgId: string
  let userId: string
  let memberId: string
  let roleId: string
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
    const registration = await request(context.app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'owner@example.test', password: 'StrongP@ss123' })
      .expect(201)
    token = registration.body.accessToken
    const org = await request(context.app.getHttpServer())
      .post('/organizations')
      .auth(token, { type: 'bearer' })
      .send({ name: 'Member tests' })
      .expect(201)
    orgId = org.body.id
    const target = await request(context.app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'member@example.test', password: 'StrongP@ss123' })
      .expect(201)
    userId = context.app.get(JwtService).verify(target.body.accessToken).sub
    roleId = (await prisma.role.findFirstOrThrow({ where: { name: 'MEMBER', isSystem: true } })).id
    memberId = (await seedOrgMember(prisma, { orgId, userId, roleId })).memberId
  })
  const path = () => `/organizations/${orgId}/members/${userId}/roles`
  async function read() {
    return (
      await request(context.app.getHttpServer())
        .get(path())
        .auth(token, { type: 'bearer' })
        .expect(200)
    ).body
  }
  async function dto(ids: string[] = []) {
    const snapshot = await read()
    return { expectedMemberId: memberId, expectedAclVersion: snapshot.aclVersion, roleIds: ids }
  }
  const save = (body: object) =>
    request(context.app.getHttpServer()).patch(path()).auth(token, { type: 'bearer' }).send(body)
  async function persisted() {
    const links = await pool.query(
      'SELECT "roleId" FROM core.member_roles WHERE "memberId"=$1 ORDER BY "roleId"',
      [memberId]
    )
    const org = await pool.query(
      'SELECT "aclVersion", "updatedAt" FROM core.organizations WHERE id=$1',
      [orgId]
    )
    const audit = await pool.query(
      `SELECT * FROM core.audit_log WHERE action='org.member_roles_changed' AND "targetId"=$1`,
      [userId]
    )
    return { links: links.rows.map((r) => r.roleId), org: org.rows[0], audit: audit.rows }
  }
  it('reads safe list/search and empty replacement; locked no-op leaves timestamp/audit untouched', async () => {
    const list = await request(context.app.getHttpServer())
      .get(`/organizations/${orgId}/members?search=member%40example.test`)
      .auth(token, { type: 'bearer' })
      .expect(200)
    expect(list.body.total).toBe(1)
    expect(list.body.data[0].user).not.toHaveProperty('systemRole')
    const before = await persisted()
    const unchanged = await dto([roleId])
    expect((await save(unchanged).expect(200)).body.changed).toBe(false)
    expect(await persisted()).toEqual(before)
    await save(await dto()).expect(200)
    const after = await persisted()
    expect(after.links).toEqual([])
    expect(after.audit).toHaveLength(1)
    expect(after.org.aclVersion).toBe(before.org.aclVersion + 1)
  })
  it('R1 serializes two stale editors with actual DB waiter; loser409', async () => {
    const input = await dto()
    const hold = holdMemberTransaction(prisma)
    const first = save(input).then((r) => r)
    let second: Promise<request.Response> | undefined
    try {
      await hold.entered
      second = save(input).then((r) => r)
      await waitForDbBlock(pool)
      hold.release()
      expect((await first).status).toBe(200)
      expect((await second).status).toBe(409)
      expect((await persisted()).audit).toHaveLength(1)
    } finally {
      hold.restore()
      await Promise.allSettled([first, ...(second ? [second] : [])])
    }
  })
  it('rejects stale no-op, replaced membership identity, foreign role and last builtin ADMIN', async () => {
    const input = await dto([roleId])
    await save({ ...input, expectedAclVersion: -1 }).expect(400)
    await save({ ...input, expectedMemberId: 'other' }).expect(409)
    await save({ ...input, roleIds: ['unavailable'] }).expect(403)
    const actor = context.app.get(JwtService).verify(token).sub
    const admin = await request(context.app.getHttpServer())
      .get(`/organizations/${orgId}/members/${actor}/roles`)
      .auth(token, { type: 'bearer' })
      .expect(200)
    await request(context.app.getHttpServer())
      .patch(`/organizations/${orgId}/members/${actor}/roles`)
      .auth(token, { type: 'bearer' })
      .send({
        expectedMemberId: admin.body.member.memberId,
        expectedAclVersion: admin.body.aclVersion,
        roleIds: [],
      })
      .expect(400)
  })
  function principal(): RequestPrincipal {
    const actor = context.app.get(JwtService).verify(token)
    return {
      type: 'jwt',
      sub: actor.sub,
      email: actor.email,
      systemRole: SystemRole.User,
      organizationId: orgId,
      aclVersion: 0,
    }
  }
  it.each(['assign', 'remove', 'delete'] as const)(
    'R2 replacement then legacy%s locks the same org before children',
    async (kind) => {
      const custom = await prisma.role.create({
        data: { name: 'Custom concurrent', organizationId: orgId },
      })
      const input = await dto([roleId, custom.id])
      const hold = holdMemberTransaction(prisma)
      const first = save(input).then((r) => r)
      let legacy: Promise<void> | undefined
      try {
        await hold.entered
        const service = context.app.get(MemberService)
        legacy =
          kind === 'assign'
            ? service.assignRole(
                orgId,
                userId,
                (await prisma.role.findFirstOrThrow({ where: { name: 'VIEWER', isSystem: true } }))
                  .id,
                principal()
              )
            : kind === 'remove'
              ? service.removeRole(orgId, userId, roleId, principal())
              : service.removeMember(orgId, userId, principal())
        await waitForDbBlock(pool)
        hold.release()
        expect((await first).status).toBe(200)
        await legacy
        const after = await persisted()
        expect(after.org.aclVersion).toBe(input.expectedAclVersion + 2)
        expect(after.links).toHaveLength(kind === 'assign' ? 3 : kind === 'remove' ? 1 : 0)
      } finally {
        hold.restore()
        await Promise.allSettled([first, ...(legacy ? [legacy] : [])])
      }
    }
  )
  it.each(['assign', 'remove', 'delete'] as const)(
    'R2 legacy%s then replacement sees changed version or unavailable member',
    async (kind) => {
      const custom = await prisma.role.create({
        data: { name: 'Custom concurrent', organizationId: orgId },
      })
      const input = await dto([custom.id])
      const hold = holdMemberTransaction(prisma, false)
      const service = context.app.get(MemberService)
      const legacy =
        kind === 'assign'
          ? service.assignRole(orgId, userId, custom.id, principal())
          : kind === 'remove'
            ? service.removeRole(orgId, userId, roleId, principal())
            : service.removeMember(orgId, userId, principal())
      let replacement: Promise<request.Response> | undefined
      try {
        await hold.entered
        replacement = save(input).then((r) => r)
        await waitForDbBlock(pool)
        hold.release()
        await legacy
        expect((await replacement).status).toBe(kind === 'delete' ? 404 : 409)
      } finally {
        hold.restore()
        await Promise.allSettled([legacy, ...(replacement ? [replacement] : [])])
      }
    }
  )
  it('R3 concurrent last-two ADMIN demotions leave one; fresh revision actually reaches last-admin400', async () => {
    const service = context.app.get(MemberRoleSetService)
    const actor = principal().sub
    const adminId = (
      await prisma.role.findFirstOrThrow({ where: { name: 'ADMIN', isSystem: true } })
    ).id
    await context.app.get(MemberService).assignRole(orgId, userId, adminId, principal())
    const actorMember = await prisma.orgMember.findUniqueOrThrow({
      where: { userId_organizationId: { userId: actor, organizationId: orgId } },
    })
    const input = await dto([])
    const hold = holdMemberTransaction(prisma)
    const first = service.replace(orgId, userId, input, principal())
    let second: Promise<unknown> | undefined
    try {
      await hold.entered
      second = service
        .replace(orgId, actor, { ...input, expectedMemberId: actorMember.id }, principal())
        .catch((e: unknown) => e)
      await waitForDbBlock(pool)
      hold.release()
      await first
      expect(await second).toMatchObject({ errorCode: 'MEMBER_ROLES_CONFLICT' })
      const fresh = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
      await expect(
        service.replace(
          orgId,
          actor,
          { ...input, expectedMemberId: actorMember.id, expectedAclVersion: fresh.aclVersion },
          principal()
        )
      ).rejects.toMatchObject({ errorCode: 'ORGANIZATION_LAST_ADMIN' })
      expect(
        await prisma.memberRole.count({
          where: { roleId: adminId, member: { organizationId: orgId } },
        })
      ).toBe(1)
    } finally {
      hold.restore()
      await Promise.allSettled([first, ...(second ? [second] : [])])
    }
  })
  it('R4 locked no-op blocks legacy writer and does not itself bump timestamp/version/audit', async () => {
    const input = await dto([roleId])
    const hold = holdMemberTransaction(prisma)
    const before = await persisted()
    const first = save(input).then((r) => r)
    let legacy: Promise<void> | undefined
    try {
      await hold.entered
      legacy = context.app.get(MemberService).removeRole(orgId, userId, roleId, principal())
      await waitForDbBlock(pool)
      expect(await persisted()).toEqual(before)
      hold.release()
      expect((await first).body.changed).toBe(false)
      await legacy
      const after = await persisted()
      expect(after.org.aclVersion).toBe(before.org.aclVersion + 1)
      expect(after.audit).toHaveLength(1)
    } finally {
      hold.restore()
      await Promise.allSettled([first, ...(legacy ? [legacy] : [])])
    }
  })
  it.each(['delete', 'permission'] as const)(
    'R5 replacement then role%s uses parent-first fence and coherent cascades',
    async (kind) => {
      const role = await prisma.role.create({ data: { name: 'Role fence', organizationId: orgId } })
      const input = await dto([role.id])
      const hold = holdMemberTransaction(prisma)
      const first = save(input).then((r) => r)
      let writer: Promise<unknown> | undefined
      try {
        await hold.entered
        const service = context.app.get(RoleService)
        writer =
          kind === 'delete'
            ? service.deleteRole(orgId, role.id, principal())
            : service.assignPermission(
                orgId,
                role.id,
                { action: Action.Read, subject: Subject.User },
                principal()
              )
        await waitForDbBlock(pool)
        hold.release()
        expect((await first).status).toBe(200)
        await writer
        const after = await persisted()
        expect(after.org.aclVersion).toBe(input.expectedAclVersion + 2)
        expect(after.links).toEqual(kind === 'delete' ? [] : [role.id])
      } finally {
        hold.restore()
        await Promise.allSettled([first, ...(writer ? [writer] : [])])
      }
    }
  )
  it('R7 RR count/rows/ACL remain coherent while an independently committed member removal runs', async () => {
    const original = prisma.$transaction.bind(prisma)
    let paused!: () => void
    let resume!: () => void
    const entered = new Promise<void>((r) => {
      paused = r
    })
    const release = new Promise<void>((r) => {
      resume = r
    })
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (
      work: (tx: never) => Promise<unknown>,
      options?: { isolationLevel?: string }
    ) => {
      if (options?.isolationLevel !== 'RepeatableRead')
        return original(work as never, options as never)
      return original(
        async (tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                if (key !== 'orgMember') return Reflect.get(target, key)
                return new Proxy(target.orgMember, {
                  get(member, method) {
                    if (method !== 'count') return Reflect.get(member, method)
                    return async (...args: unknown[]) => {
                      const value = await (member.count as (...a: unknown[]) => Promise<number>)(
                        ...args
                      )
                      paused()
                      await release
                      return value
                    }
                  },
                })
              },
            }) as never
          ),
        options as never
      )
    }) as never)
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
    const reading = context.app.get(MemberQueryService).list(orgId, orgId, { page: 1, limit: 20 })
    try {
      await entered
      await context.app.get(MemberService).removeMember(orgId, userId, principal())
      resume()
      const result = await reading
      expect(result.total).toBe(2)
      expect(result.data).toHaveLength(2)
      expect(result.aclVersion).toBe(before.aclVersion)
    } finally {
      resume()
      spy.mockRestore()
      await Promise.allSettled([reading])
    }
  })
  it('R8 custom DENY self-edit stays acknowledged, next request uses fresh TeamAccess', async () => {
    const actor = principal().sub
    const deny = await prisma.role.create({
      data: {
        name: 'Read only',
        organizationId: orgId,
        permissions: {
          create: {
            permission: {
              create: {
                organizationId: orgId,
                action: 'manage',
                subject: 'TeamAccess',
                inverted: true,
              },
            },
          },
        },
      },
    })
    const initial = await request(context.app.getHttpServer())
      .get(`/organizations/${orgId}/members/${actor}/roles`)
      .auth(token, { type: 'bearer' })
      .expect(200)
    const result = await request(context.app.getHttpServer())
      .patch(`/organizations/${orgId}/members/${actor}/roles`)
      .auth(token, { type: 'bearer' })
      .send({
        expectedMemberId: initial.body.member.memberId,
        expectedAclVersion: initial.body.aclVersion,
        roleIds: [...initial.body.assignedRoles.map((r: { id: string }) => r.id), deny.id],
      })
      .expect(200)
    expect(result.body.changed).toBe(true)
    await request(context.app.getHttpServer())
      .get(`/organizations/${orgId}/members`)
      .auth(token, { type: 'bearer' })
      .expect(403)
  })
  it('R6a audit precommit failure rolls back links, ACL, timestamp and audit', async () => {
    const input = await dto()
    const before = await persisted()
    const spy = jest
      .spyOn(context.app.get(AuditLogService), 'record')
      .mockRejectedValueOnce(new Error('precommit fault'))
    try {
      await save(input).expect(503)
      expect(await persisted()).toEqual(before)
    } finally {
      spy.mockRestore()
    }
  })
  it('R6b REAL commit followed by lost acknowledgment returns503, one write/ACL/audit; no replay', async () => {
    const input = await dto()
    const before = await persisted()
    const original = prisma.$transaction.bind(prisma)
    let calls = 0
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (
      work: never,
      options?: { timeout?: number }
    ) => {
      const result = await original(work, options)
      if (options?.timeout === 4000) {
        calls++
        throw new Error('acknowledgment lost AFTER committed transaction')
      }
      return result
    }) as never)
    try {
      const failed = await save(input).expect(503)
      expect(failed.body.errorCode).toBe('MEMBER_ROLES_SAVE_UNAVAILABLE')
      const after = await persisted()
      expect(after.links).toEqual([])
      expect(after.org.aclVersion).toBe(before.org.aclVersion + 1)
      expect(after.audit).toHaveLength(1)
      expect(after.org.updatedAt.getTime()).toBeGreaterThan(before.org.updatedAt.getTime())
      expect(calls).toBe(1)
      const snapshot = await read()
      expect(snapshot.assignedRoleCount).toBe(0)
      expect(snapshot.aclVersion).toBe(input.expectedAclVersion + 1)
      if (process.env.T026_R6B_CAPTURE)
        writeFileSync(
          process.env.T026_R6B_CAPTURE,
          JSON.stringify({
            status: failed.status,
            body: failed.body,
            snapshot,
            transportCount: calls,
            auditCount: after.audit.length,
            aclBefore: input.expectedAclVersion,
          })
        )
      expect(calls).toBe(1)
      expect(after.audit[0].metadata).toMatchObject({
        memberId,
        removedCount: 1,
        addedCount: 0,
        source: 'replace',
        actorCredentialType: 'jwt',
      })
    } finally {
      spy.mockRestore()
    }
  })
  it('R9 101/1000 editable,1001 oversized; worst Unicode metadata byteOversized', async () => {
    const roles = Array.from({ length: 1001 }, (_, i) => ({
      id: `test-role-${i}`,
      name: `Role${i}`,
      description: null as string | null,
      organizationId: orgId,
      isSystem: false,
    }))
    await prisma.role.createMany({ data: roles })
    await prisma.memberRole.deleteMany({ where: { memberId } })
    for (const count of [101, 1000, 1001]) {
      await prisma.memberRole.deleteMany({ where: { memberId } })
      await prisma.memberRole.createMany({
        data: roles.slice(0, count).map((r) => ({ memberId, roleId: r.id })),
      })
      const result = await read()
      expect(result.editMode).toBe(count > 1000 ? 'oversized' : 'editable')
      expect(result.assignedRoles?.length ?? null).toBe(count > 1000 ? null : count)
    }
    await prisma.memberRole.deleteMany({ where: { memberId, roleId: roles[1000]!.id } })
    // Names are unique per organization; descriptions alone suffice to exceed byte snapshot cap.
    await prisma.role.updateMany({
      where: { organizationId: orgId },
      data: { description: '漢'.repeat(255) },
    })
    const result = await read()
    expect(result.editMode).toBe('byteOversized')
    expect(result.assignedRoles).toBeNull()
    expect(result.choices.data.length).toBe(20)
  })
  it('new routes reject a valid bound API key, mismatched selector and nonmember SUPER_ADMIN', async () => {
    const key = await request(context.app.getHttpServer())
      .post('/api-keys')
      .auth(token, { type: 'bearer' })
      .send({ name: 'Member policy probe', organizationId: orgId, scopes: ['manage:TeamAccess'] })
      .expect(201)
    await request(context.app.getHttpServer())
      .get('/auth/me')
      .auth(key.body.key, { type: 'bearer' })
      .expect(200)
    for (const suffix of ['', `/${userId}/roles`])
      await request(context.app.getHttpServer())
        .get(`/organizations/${orgId}/members${suffix}`)
        .auth(key.body.key, { type: 'bearer' })
        .expect(401)
    await request(context.app.getHttpServer())
      .patch(path())
      .auth(key.body.key, { type: 'bearer' })
      .send(await dto())
      .expect(401)
    await request(context.app.getHttpServer())
      .get(path())
      .auth(token, { type: 'bearer' })
      .set('x-amcore-organization-id', 'other-org')
      .expect(400)
    const elevated = context.app
      .get(JwtService)
      .sign({ sub: userId, email: 'member@example.test', systemRole: 'SUPER_ADMIN' })
    await prisma.user.update({ where: { id: userId }, data: { systemRole: SystemRole.SuperAdmin } })
    await prisma.orgMember.delete({ where: { id: memberId } })
    await request(context.app.getHttpServer())
      .get(path())
      .auth(elevated, { type: 'bearer' })
      .expect(403)
  })
  it('R2 removed and rejoined user cannot accept an old membership draft', async () => {
    const input = await dto([])
    await context.app.get(MemberService).removeMember(orgId, userId, principal())
    const next = await seedOrgMember(prisma, { orgId, userId, roleId })
    const fresh = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
    await save({ ...input, expectedAclVersion: fresh.aclVersion }).expect(409)
    expect(await prisma.memberRole.count({ where: { memberId: next.memberId, roleId } })).toBe(1)
  })
  it('R9c canonical1000 maximum-length IDs pass the scoped parser and commit a complete set', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `role-${i}-`.padEnd(128, 'x'))
    await prisma.role.createMany({
      data: ids.map((id, i) => ({ id, name: `Long ID ${i}`, organizationId: orgId })),
    })
    const body = await dto(ids)
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(100000)
    const result = await save(body).expect(200)
    expect(result.body.roleIds).toHaveLength(1000)
    expect((await persisted()).links).toEqual([...ids].sort())
  })
  it.each(['delete', 'permission'] as const)(
    'R5 role%s first makes a competing replacement stale',
    async (kind) => {
      const role = await prisma.role.create({ data: { name: 'Role first', organizationId: orgId } })
      const input = await dto([role.id])
      const hold = holdMemberTransaction(prisma, false)
      const service = context.app.get(RoleService)
      const writer =
        kind === 'delete'
          ? service.deleteRole(orgId, role.id, principal())
          : service.assignPermission(
              orgId,
              role.id,
              { action: Action.Read, subject: Subject.User },
              principal()
            )
      let replacement: Promise<request.Response> | undefined
      try {
        await hold.entered
        replacement = save(input).then((r) => r)
        await waitForDbBlock(pool)
        hold.release()
        await writer
        expect((await replacement).status).toBe(409)
        expect((await persisted()).links).toEqual([roleId])
      } finally {
        hold.restore()
        await Promise.allSettled([writer, ...(replacement ? [replacement] : [])])
      }
    }
  )

  it.each(['accept-first', 'replace-first'] as const)(
    'R5 invite%s shares parent lock with replacement',
    async (order) => {
      const registered = await request(context.app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'invitee@example.test', password: 'StrongP@ss123' })
        .expect(201)
      const invitee = context.app.get(JwtService).verify(registered.body.accessToken)
      await prisma.user.update({ where: { id: invitee.sub }, data: { emailVerified: true } })
      const rawToken = randomBytes(32).toString('base64url')
      await prisma.orgInvite.create({
        data: {
          organizationId: orgId,
          email: invitee.email,
          emailCanonical: invitee.email,
          roleId,
          invitedById: principal().sub,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt: new Date(Date.now() + 60000),
        },
      })
      const input = await dto([])
      const hold = holdMemberTransaction(prisma, order === 'replace-first')
      const accept = () =>
        context.app
          .get(InviteService)
          .acceptInvite(
            rawToken,
            { type: 'jwt', sub: invitee.sub, email: invitee.email, systemRole: SystemRole.User },
            '127.0.0.1'
          )
      let second: Promise<unknown> | undefined
      const first = order === 'accept-first' ? accept() : save(input).then((r) => r)
      try {
        await hold.entered
        second = order === 'accept-first' ? save(input).then((r) => r) : accept()
        await waitForDbBlock(pool)
        hold.release()
        const result = (await (order === 'accept-first' ? second : first)) as request.Response
        expect(result.status).toBe(order === 'accept-first' ? 409 : 200)
        await (order === 'accept-first' ? first : second)
        expect(
          await prisma.orgMember.count({ where: { userId: invitee.sub, organizationId: orgId } })
        ).toBe(1)
      } finally {
        hold.restore()
        await Promise.allSettled([first, ...(second ? [second] : [])])
      }
    }
  )
  it('R9b API DTO serialized byte boundary1048448/1048449 is enforced before success', async () => {
    const endpoint = `/organizations/${orgId}/members?search=member%40example.test`
    const role = await prisma.role.create({
      data: { name: 'Byte boundary', description: '', organizationId: orgId },
    })
    await prisma.memberRole.deleteMany({ where: { memberId } })
    await prisma.memberRole.create({ data: { memberId, roleId: role.id } })
    const baseline = await request(context.app.getHttpServer())
      .get(endpoint)
      .auth(token, { type: 'bearer' })
      .expect(200)
    const emptyBytes = Buffer.byteLength(JSON.stringify(baseline.body))
    const marker = '漢😀\n"'
    const markerBytes = Buffer.byteLength(JSON.stringify(marker)) - 2
    for (const bytes of [1048448, 1048449]) {
      await prisma.role.update({
        where: { id: role.id },
        data: { description: marker + 'a'.repeat(bytes - emptyBytes - markerBytes) },
      })
      const result = await request(context.app.getHttpServer())
        .get(endpoint)
        .auth(token, { type: 'bearer' })
      expect(result.status).toBe(bytes === 1048448 ? 200 : 503)
      expect(result.body.errorCode ?? Buffer.byteLength(JSON.stringify(result.body))).toBe(
        bytes === 1048448 ? bytes : 'MEMBER_READ_UNAVAILABLE'
      )
    }
  })
  it.each(['create', 'reissue'] as const)(
    'A2-I04 invite %s vs role-delete serializes both lock orders',
    async (kind) => {
      for (const inviteFirst of [true, false]) {
        const role = await prisma.role.create({
          data: { name: `Invite fence ${inviteFirst}`, organizationId: orgId },
        })
        const email = `fence-${kind}-${inviteFirst}@example.test`
        const invites = context.app.get(InviteService)
        if (kind === 'reissue')
          await invites.createInvite(orgId, { email, roleId: role.id }, principal())
        const trace: string[] = []
        const hold = holdMemberTransaction(prisma, false, trace)
        const inviting = () => invites.createInvite(orgId, { email, roleId: role.id }, principal())
        const deleting = () => context.app.get(RoleService).deleteRole(orgId, role.id, principal())
        const first = (inviteFirst ? inviting() : deleting()).then(
          () => 'ok',
          () => 'rejected'
        )
        let second: Promise<string> | undefined
        try {
          await hold.entered
          second = (inviteFirst ? deleting() : inviting()).then(
            () => 'ok',
            () => 'rejected'
          )
          await waitForDbBlock(pool)
          hold.release()
          expect(await first).toBe('ok')
          expect(trace).toEqual(
            inviteFirst
              ? [
                  'advisory',
                  'parent',
                  'invite:findFirst',
                  kind === 'create' ? 'invite:create' : 'invite:update',
                ]
              : ['parent']
          )
          expect(await second).toBe(inviteFirst ? 'ok' : 'rejected')
          expect(await prisma.role.count({ where: { id: role.id } })).toBe(0)
          const rows = await pool.query(
            'SELECT "roleId" FROM core.org_invites WHERE "organizationId"=$1 AND "emailCanonical"=$2',
            [orgId, email]
          )
          expect(rows.rows.every((r) => r.roleId === null)).toBe(true)
        } finally {
          hold.restore()
          await Promise.allSettled([first, ...(second ? [second] : [])])
        }
      }
    }
  )
  it.each([true, false])(
    'A2-I04 organization delete vs replacement, replacement first=%s',
    async (replacementFirst) => {
      const input = await dto([])
      const hold = holdMemberTransaction(prisma, false)
      const deleting = () =>
        request(context.app.getHttpServer())
          .delete(`/organizations/${orgId}`)
          .auth(token, { type: 'bearer' })
          .then((r) => r)
      const first = replacementFirst ? save(input).then((r) => r) : deleting()
      let second: Promise<request.Response> | undefined
      try {
        await hold.entered
        second = replacementFirst ? deleting() : save(input).then((r) => r)
        await waitForDbBlock(pool)
        hold.release()
        expect((await first).status).toBe(replacementFirst ? 200 : 204)
        expect((await second).status).toBe(replacementFirst ? 204 : 404)
        expect(
          (await pool.query('SELECT id FROM core.organizations WHERE id=$1', [orgId])).rowCount
        ).toBe(0)
        expect(
          (await pool.query('SELECT id FROM core.member_roles WHERE "memberId"=$1', [memberId]))
            .rowCount
        ).toBe(0)
      } finally {
        hold.restore()
        await Promise.allSettled([first, ...(second ? [second] : [])])
      }
    }
  )
  it('A2-I04 external FK blocks link delete and rolls back all assignment state', async () => {
    const input = await dto([])
    const before = await persisted()
    await pool.query(
      'CREATE TABLE core.t026_external_link ("linkId" text REFERENCES core.member_roles(id) ON DELETE RESTRICT)'
    )
    try {
      await pool.query(
        'INSERT INTO core.t026_external_link SELECT id FROM core.member_roles WHERE "memberId"=$1',
        [memberId]
      )
      const failed = await save(input).expect(503)
      expect(failed.body.errorCode).toBe('MEMBER_ROLES_SAVE_UNAVAILABLE')
      expect(await persisted()).toEqual(before)
    } finally {
      await pool.query('DROP TABLE core.t026_external_link')
    }
  })
  it('A2-I04 post-link failed CAS returns409 and real transaction restores deleted links', async () => {
    const input = await dto([])
    const before = await persisted()
    const original = prisma.$transaction.bind(prisma)
    let deleted = 0
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (
      work: never,
      options?: { timeout?: number }
    ) => {
      if (options?.timeout !== 4000) return original(work, options)
      return original(
        async (tx) =>
          (work as (t: unknown) => Promise<unknown>)(
            new Proxy(tx, {
              get(target, key) {
                if (key === 'memberRole')
                  return new Proxy(target.memberRole, {
                    get(model, name) {
                      if (name !== 'deleteMany') return Reflect.get(model, name)
                      return async (args: never) => {
                        const result = await model.deleteMany(args)
                        deleted += result.count
                        return result
                      }
                    },
                  })
                if (key === 'organization')
                  return new Proxy(target.organization, {
                    get(model, name) {
                      return name === 'updateMany'
                        ? async () => ({ count: 0 })
                        : Reflect.get(model, name)
                    },
                  })
                return Reflect.get(target, key)
              },
            })
          ),
        options
      )
    }) as never)
    try {
      const failed = await save(input).expect(409)
      expect(failed.body.errorCode).toBe('MEMBER_ROLES_CONFLICT')
      expect(deleted).toBe(1)
      expect(await persisted()).toEqual(before)
    } finally {
      spy.mockRestore()
    }
  })
})
