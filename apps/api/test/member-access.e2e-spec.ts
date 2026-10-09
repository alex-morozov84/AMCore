import { JwtService } from '@nestjs/jwt'
import { Pool } from 'pg'
import request from 'supertest'

import {
  ACCESS_MAX_UNIQUE_RULES,
  memberAccessSchema,
  ROLE_EDITABLE_RULE_LIMIT,
} from '@amcore/shared'

import type { PrismaService } from '../src/prisma'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'

describe('Member access explanation (real DB)', () => {
  let context: E2ETestContext
  let prisma: PrismaService
  let pool: Pool
  let token: string
  let orgId: string
  let ownerId: string

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
    const owner = await register('owner@example.test')
    token = owner.accessToken
    ownerId = context.app.get(JwtService).verify(token).sub
    orgId = (
      await http()
        .post('/organizations')
        .auth(token, { type: 'bearer' })
        .send({ name: 'Access lab' })
        .expect(201)
    ).body.id
  })

  const http = () => request(context.app.getHttpServer())
  async function register(email: string) {
    return (
      await http().post('/auth/register').send({ email, password: 'StrongP@ss123' }).expect(201)
    ).body as { accessToken: string }
  }
  const access = (userId: string, bearer = token) =>
    http().get(`/organizations/${orgId}/members/${userId}/access`).auth(bearer, { type: 'bearer' })

  /** A member with exactly these custom roles (each: its rules); returns the member's user id. */
  async function memberWith(
    email: string,
    roles: Record<
      string,
      { action: string; subject: string; fields?: string[]; inverted?: boolean }[]
    >
  ) {
    const registered = await register(email)
    const userId = context.app.get(JwtService).verify(registered.accessToken).sub
    const member = await prisma.orgMember.create({ data: { userId, organizationId: orgId } })
    for (const [name, rules] of Object.entries(roles)) {
      const role = await prisma.role.create({ data: { name, organizationId: orgId } })
      for (const rule of rules) {
        const permission = await prisma.permission.create({
          data: { ...rule, fields: rule.fields ?? [], organizationId: orgId },
        })
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        })
      }
      await prisma.memberRole.create({ data: { memberId: member.id, roleId: role.id } })
    }
    await prisma.organization.update({
      where: { id: orgId },
      data: { aclVersion: { increment: 1 } },
    })
    return { userId, memberId: member.id }
  }
  const key = (body: { items: ({ key: string } & Record<string, unknown>)[] }, k: string) =>
    body.items.find((i) => i.key === k)!
  const READ_ALL = ['id', 'name', 'slug', 'aclVersion', 'createdAt', 'updatedAt']

  it('explains the built-in ADMIN: full team control and own-organization edit, delete and read', async () => {
    const response = await access(ownerId).expect(200)
    expect(memberAccessSchema.safeParse(response.body).success).toBe(true)
    const body = response.body
    expect(body.scope).toBe('organization-membership')
    expect(body.roles.items.map((r: { name: string }) => r.name)).toContain('ADMIN')
    for (const k of ['teamAccess.manage', 'organization.update', 'organization.delete'])
      expect(key(body, k)).toMatchObject({ granted: true, reason: 'granted' })
    expect(key(body, 'organization.read')).toMatchObject({ baseline: true, granted: true })
    // Reading the own user record and editing the own profile are rules outside the catalogue.
    expect(body.uncovered.ruleCount).toBeGreaterThanOrEqual(2)
    expect(body.widening.status).toBe('computed')
  })

  it('shows two roles that each grant one field, and a role that vetoes one of them', async () => {
    const { userId } = await memberWith('combo@example.test', {
      A: [
        { action: 'read', subject: 'Organization', fields: READ_ALL },
        { action: 'update', subject: 'Organization', fields: ['name'] },
      ],
      B: [
        { action: 'read', subject: 'Organization', fields: READ_ALL },
        { action: 'update', subject: 'Organization', fields: ['slug'] },
      ],
      C: [{ action: 'update', subject: 'Organization', fields: ['name'], inverted: true }],
    })
    const body = (await access(userId).expect(200)).body
    expect(key(body, 'organization.update.slug')).toMatchObject({ granted: true, origin: 'single' })
    expect(key(body, 'organization.update.name')).toMatchObject({
      granted: false,
      reason: 'vetoed',
    })
    expect(body.widening).toMatchObject({ status: 'computed', vetoed: true })
    // The same member can read this decision and the roles that produced it.
    expect(body.roles.total).toBe(3)
  })

  it('excludes a role from another organization and only counts the link', async () => {
    const { userId, memberId } = await memberWith('alien@example.test', {})
    const other = await register('other-owner@example.test')
    const otherOrg = (
      await http()
        .post('/organizations')
        .auth(other.accessToken, { type: 'bearer' })
        .send({ name: 'Other' })
        .expect(201)
    ).body.id
    const foreign = await prisma.role.create({
      data: { name: 'Foreign', organizationId: otherOrg },
    })
    const permission = await prisma.permission.create({
      data: { action: 'manage', subject: 'TeamAccess', fields: [], organizationId: otherOrg },
    })
    await prisma.rolePermission.create({
      data: { roleId: foreign.id, permissionId: permission.id },
    })
    await prisma.memberRole.create({ data: { memberId, roleId: foreign.id } })
    const body = (await access(userId).expect(200)).body
    expect(body.unsafeLinkCount).toBe(1)
    expect(body.roles.total).toBe(0)
    expect(key(body, 'teamAccess.manage').granted).toBe(false)
  })

  it('keeps explaining a policy the editor would call oversized', async () => {
    const rules = Array.from({ length: ROLE_EDITABLE_RULE_LIMIT + 5 }, () => ({
      action: 'read',
      subject: 'User',
      fields: ['id'],
    }))
    const { userId } = await memberWith('big@example.test', { Big: rules })
    const body = (await access(userId).expect(200)).body
    expect(body.uncovered.ruleCount).toBe(ROLE_EDITABLE_RULE_LIMIT + 5)
  })

  it('fails closed over the rule limit and for a stored rule that is not valid', async () => {
    const huge = Array.from({ length: ACCESS_MAX_UNIQUE_RULES + 1 }, () => ({
      action: 'read',
      subject: 'User',
      fields: ['id'],
    }))
    const { userId } = await memberWith('huge@example.test', { Huge: huge })
    const limited = await access(userId).expect(503)
    expect(limited.body.errorCode).toBe('ROLE_ACCESS_UNAVAILABLE')
    const broken = await memberWith('broken@example.test', {
      Broken: [{ action: 'read', subject: 'Organization', fields: ['not-a-field'] }],
    })
    expect((await access(broken.userId).expect(503)).body.errorCode).toBe('ROLE_ACCESS_UNAVAILABLE')
  })

  it('answers 404 for a user who is not a member and refuses an ordinary member', async () => {
    const stranger = await register('stranger@example.test')
    const strangerId = context.app.get(JwtService).verify(stranger.accessToken).sub
    expect((await access(strangerId).expect(404)).body.errorCode).toBe('MEMBER_UNAVAILABLE')
    const plain = await memberWith('plain@example.test', {})
    const plainToken = (
      await http()
        .post('/auth/login')
        .send({ email: 'plain@example.test', password: 'StrongP@ss123' })
        .expect(200)
    ).body.accessToken
    await access(ownerId, plainToken).expect(403)
    void plain
    void pool
  })
})
