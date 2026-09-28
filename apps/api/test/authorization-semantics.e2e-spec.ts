import { randomUUID } from 'node:crypto'

import request from 'supertest'

import { SystemRole } from '@amcore/shared'

import { admissionForTest } from '../src/core/auth/__tests__/privileged-admission.fixture'
import { AbilityFactory } from '../src/core/auth/casl/ability.factory'
import { ORG_READ_FIELDS } from '../src/core/auth/casl/org-role-defaults'
import { Prisma } from '../src/generated/prisma/client'

import {
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  signAccessToken,
  teardownE2ETest,
} from './helpers'

describe('Explicit organization authorization (real HTTP/Postgres/Redis)', () => {
  let context: E2ETestContext
  let orgId: string
  let userId: string
  let memberId: string
  let token: string
  let roleId: string
  const oldTime = new Date('2000-01-01T00:00:00.000Z')
  beforeAll(async () => {
    context = await setupE2ETest()
    await seedSystemRoles(context.prisma)
  }, 120000)
  afterAll(async () => {
    if (context) await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await context.throttlerStorage.reset()
    const email = `${randomUUID()}@example.com`
    const user = await context.prisma.user.create({
      data: { email, emailCanonical: email, emailVerified: true },
    })
    userId = user.id
    const org = await context.prisma.organization.create({
      data: { name: 'Before', slug: randomUUID(), updatedAt: oldTime },
    })
    orgId = org.id
    const member = await context.prisma.orgMember.create({
      data: { userId, organizationId: orgId },
    })
    memberId = member.id
    const role = await context.prisma.role.create({
      data: { name: 'Limited', organizationId: orgId },
    })
    roleId = role.id
    await context.prisma.memberRole.create({ data: { memberId, roleId } })
    token = signAccessToken(context.app, {
      sub: userId,
      email,
      systemRole: SystemRole.User,
      organizationId: orgId,
      aclVersion: 0,
    })
  })
  async function grant(
    action: string,
    subject: string,
    extra: { fields?: string[]; conditions?: Prisma.InputJsonObject; inverted?: boolean } = {}
  ) {
    return context.prisma.$transaction(async (tx) => {
      const permission = await tx.permission.create({
        data: { action, subject, organizationId: orgId, ...extra },
      })
      await tx.rolePermission.create({ data: { roleId, permissionId: permission.id } })
      await tx.organization.update({
        where: { id: orgId },
        data: { aclVersion: { increment: 1 }, updatedAt: oldTime },
      })
      return permission
    })
  }
  const http = () => request(context.app.getHttpServer())
  async function key(scopes: string[]) {
    const response = await http()
      .post('/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Fixture key', organizationId: orgId, scopes })
      .expect(201)
    return response.body.key as string
  }
  const readFields = () =>
    grant('read', 'Organization', { conditions: { id: orgId }, fields: ORG_READ_FIELDS })

  it('limited name manager updates data but cannot grant itself team authority or destroy the team', async () => {
    await readFields()
    await grant('update', 'Organization', { fields: ['name'] })
    await http()
      .patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Allowed' })
      .expect(200)
    await http()
      .patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: 'forbidden' })
      .expect(403)
    await http()
      .post(`/organizations/${orgId}/roles/${roleId}/permissions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'manage', subject: 'TeamAccess' })
      .expect(403)
    await http()
      .delete(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
    expect(
      (await context.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).slug
    ).not.toBe('forbidden')
  })

  it.each(['update', 'read'])(
    'R2 actual @updatedAt %s DENY rolls back the complete PATCH',
    async (action) => {
      await readFields()
      await grant('update', 'Organization', { fields: ['name'] })
      const persisted = await grant(action, 'Organization', {
        inverted: true,
        conditions: { updatedAt: { gt: oldTime.getTime() } },
        ...(action === 'read' ? { fields: ['updatedAt'] } : {}),
      })
      expect(persisted.conditions).toEqual({ updatedAt: { gt: oldTime.getTime() } })
      const before = await context.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
      const factory = context.app.get(AbilityFactory)
      // Full owner parsing happens in the HTTP factory; no in-memory Date-valued substitute.
      await expect(
        factory.createForUser(
          await admissionForTest({
            type: 'jwt',
            sub: userId,
            organizationId: orgId,
            aclVersion: 0,
            systemRole: SystemRole.User,
          })
        )
      ).resolves.toBeDefined()
      const result = await http()
        .patch(`/organizations/${orgId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Must rollback' })
        .expect(403)
      expect(result.body.errorCode).toBe('FORBIDDEN')
      const after = await context.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
      expect(after).toEqual(before)
    }
  )

  it('empty patch preserves updatedAt; permitted nonempty response equals persisted timestamp', async () => {
    await readFields()
    await grant('update', 'Organization', { fields: ['name'] })
    const empty = await http()
      .patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200)
    expect(empty.body.updatedAt).toBe(oldTime.toISOString())
    const changed = await http()
      .patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'After' })
      .expect(200)
    const persisted = await context.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
    expect(changed.body.updatedAt).toBe(persisted.updatedAt.toISOString())
    expect(persisted.updatedAt.getTime()).toBeGreaterThan(oldTime.getTime())
  })

  it('keys require exact TeamAccess and retain unscoped owner veto', async () => {
    await grant('manage', 'TeamAccess')
    for (const scope of ['manage:Organization', 'read:TeamAccess']) {
      const credential = await key([scope])
      const response = await http()
        .get(`/organizations/${orgId}/roles`)
        .set('Authorization', `Bearer ${credential}`)
        .expect(403)
      expect(response.body.errorCode).toBe('FORBIDDEN')
    }
    const credential = await key(['manage:TeamAccess'])
    await http()
      .get(`/organizations/${orgId}/roles`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(200)
    await grant('read', 'Role', {
      inverted: true,
      fields: ['name'],
      conditions: { id: 'impossible' },
    })
    await http()
      .get(`/organizations/${orgId}/roles`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(403)
  })

  it('team-only authority cannot delete org; field-limited deletion fails; unrestricted succeeds', async () => {
    await grant('manage', 'TeamAccess')
    await http()
      .delete(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
    await grant('delete', 'Organization', { fields: ['name'] })
    await http()
      .delete(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
    await grant('delete', 'Organization')
    await http()
      .delete(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204)
    expect(await context.prisma.organization.findUnique({ where: { id: orgId } })).toBeNull()
  })

  it('key GET checks actual conditions and every response field, while JWT discovery remains membership-based', async () => {
    const credential = await key(['read:Organization'])
    await grant('read', 'Organization', { conditions: { id: 'wrong' } })
    await http()
      .get(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(403)
    await grant('read', 'Organization', { fields: ['name'] })
    await http()
      .get(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(403)
    await readFields()
    await http()
      .get(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(200)
    await grant('read', 'Organization', { inverted: true, fields: ['slug'] })
    await http()
      .get(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${credential}`)
      .expect(403)
    const discovery = await http()
      .get(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(discovery.body.id).toBe(orgId)
  })

  it('schema rejects positive all and partial TeamAccess with 400', async () => {
    await grant('manage', 'TeamAccess')
    for (const payload of [
      { action: 'read', subject: 'all' },
      { action: 'manage', subject: 'TeamAccess', fields: ['name'] },
    ]) {
      await http()
        .post(`/organizations/${orgId}/roles/${roleId}/permissions`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(400)
    }
    expect(await context.prisma.permission.count({ where: { organizationId: orgId } })).toBe(1)
  })
})
