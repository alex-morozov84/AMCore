import { randomUUID } from 'node:crypto'

import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import request from 'supertest'

import { coerceSupportedLocale } from '@amcore/shared'

import type { EstablishmentDatabase } from '../src/core/organizations/establishment-transaction'
import { OrganizationSetupOperations } from '../src/core/organizations/organization-setup-operations'

import {
  cleanDatabase,
  cleanOrgData,
  type E2ETestContext,
  seedSystemRoles,
  setupE2ETest,
  teardownE2ETest,
} from './helpers'
import { loginDomainOperator } from './operator-auth.fixture.js'

describe('Organization establishment (e2e)', () => {
  let context: E2ETestContext
  let token: string
  let userId: string
  const intent = { name: 'Ромашка', slug: 'romashka' }
  const http = () => request(context.app.getHttpServer())
  const setup = () => new OrganizationSetupOperations(context.prisma, false)

  beforeAll(async () => {
    context = await setupE2ETest()
    await seedSystemRoles(context.prisma)
  }, 120000)
  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    await cleanOrgData(context.prisma)
    await cleanDatabase(context.prisma, context.cache, context.throttlerStorage)
    context.app.get(ConfigService).set('ORG_SELF_SERVICE_CREATION_ENABLED', true)
    context.app.get(ConfigService).set('AUTH_PUBLIC_SIGNUP_ENABLED', true)
    const response = await http()
      .post('/auth/register')
      .send({ email: 'creator@example.test', password: 'StrongP@ss123' })
      .expect(201)
    token = response.body.accessToken
    userId = context.app.get(JwtService).verify(token).sub
  })

  const create = (operationId?: string, input = intent) => {
    const req = http().post('/organizations').auth(token, { type: 'bearer' }).send(input)
    return operationId ? req.set('X-Organization-Creation-Id', operationId) : req
  }

  it('preserves unverified bearer admission and legacy body stripping with explicit creation', async () => {
    const user = await context.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(user.emailVerified).toBe(false)
    const response = await http()
      .post('/organizations')
      .auth(token, { type: 'bearer' })
      .send({ ...intent, creatorId: 'someone-else', systemRole: 'SUPER_ADMIN', skipPolicy: true })
      .expect(201)
    expect(
      await context.prisma.orgMember.findFirst({
        where: { userId, organizationId: response.body.id },
      })
    ).not.toBeNull()
    expect(await context.prisma.user.findUnique({ where: { id: userId } })).toMatchObject({
      systemRole: 'USER',
    })
    expect(
      await context.prisma.auditLog.count({ where: { action: 'org.created', actorId: userId } })
    ).toBe(1)
  })

  it('deduplicates identified create, rejects changed intent, and returns current renamed metadata', async () => {
    const id = randomUUID()
    const first = await create(id).expect(201)
    await context.prisma.organization.update({
      where: { id: first.body.id },
      data: { name: 'Renamed' },
    })
    const replay = await create(id).expect(201)
    expect(replay.body).toMatchObject({ id: first.body.id, name: 'Renamed' })
    await create(id, { ...intent, name: 'Other' })
      .expect(409)
      .expect(({ body }) => expect(body.errorCode).toBe('ORGANIZATION_CREATION_INTENT_MISMATCH'))
    expect(await context.prisma.organization.count()).toBe(1)
    expect(
      await context.prisma.auditLog.count({ where: { action: 'org.created', actorId: userId } })
    ).toBe(1)
    const result = await http()
      .get(`/organizations/creation-results/${id}`)
      .auth(token, { type: 'bearer' })
      .expect(200)
    expect(result.headers['cache-control']).toContain('no-store')
    expect(result.body.organizationId).toBe(first.body.id)
  })

  it('does not restore a replaced grant or recreate a deleted organization', async () => {
    const id = randomUUID()
    await create(id).expect(201)
    const receipt = await context.prisma.organizationCreationResult.findUniqueOrThrow({
      where: { actorId_operationId: { actorId: userId, operationId: id } },
    })
    await context.prisma.memberRole.delete({ where: { id: receipt.adminGrantId } })
    await context.prisma.memberRole.create({
      data: { roleId: receipt.adminRoleId, memberId: receipt.memberId },
    })
    await create(id)
      .expect(409)
      .expect(({ body }) => expect(body.errorCode).toBe('ORGANIZATION_CREATION_RESULT_CHANGED'))
    await context.prisma.organization.delete({ where: { id: receipt.organizationId } })
    await create(id).expect(409)
    expect(await context.prisma.organization.count()).toBe(0)
    expect(await context.prisma.organizationCreationResult.count()).toBe(1)
  })

  it('keeps result recovery available when creation is disabled and never accepts a skip flag', async () => {
    const id = randomUUID()
    await create(id).expect(201)
    context.app.get(ConfigService).set('ORG_SELF_SERVICE_CREATION_ENABLED', false)
    await create(id).expect(403)
    await http()
      .get(`/organizations/creation-results/${id}`)
      .auth(token, { type: 'bearer' })
      .expect(200)
    await http()
      .get('/organizations/creation-policy')
      .auth(token, { type: 'bearer' })
      .expect(200, { selfServiceCreationEnabled: false })
    await http().get('/organizations/creation-policy').expect(401)
  })

  it('validates operation IDs and classifies explicit slug collisions consistently', async () => {
    await create('invalid').expect(400)
    await create(`${randomUUID()},${randomUUID()}`).expect(400)
    await create().expect(201)
    await create()
      .expect(409)
      .expect(({ body }) => expect(body.errorCode).toBe('CONFLICT'))
    const generated = await http()
      .post('/organizations')
      .auth(token, { type: 'bearer' })
      .send({ name: '🌷🌷' })
      .expect(201)
    expect(generated.body.slug).toMatch(/^organization-[0-9a-f]{8}$/)
  })

  it('keeps public signup, organization creation and staff membership independent in all four combinations', async () => {
    for (const signup of [true, false])
      for (const creation of [true, false]) {
        context.app.get(ConfigService).set('AUTH_PUBLIC_SIGNUP_ENABLED', signup)
        context.app.get(ConfigService).set('ORG_SELF_SERVICE_CREATION_ENABLED', creation)
        const registered = await http()
          .post('/auth/register')
          .send({ email: `buyer-${signup}-${creation}@example.test`, password: 'StrongP@ss123' })
          .expect(signup ? 201 : 403)
        expect(Boolean(registered.body.user?.id)).toBe(signup)
        expect(
          await context.prisma.orgMember.count({
            where: { userId: registered.body.user?.id ?? '<no-created-buyer>' },
          })
        ).toBe(0)
        const before = await context.prisma.organization.count()
        await create(randomUUID(), {
          name: 'Independent policy',
          slug: `company-${signup}-${creation}`,
        }).expect(creation ? 201 : 403)
        expect(await context.prisma.organization.count()).toBe(before + (creation ? 1 : 0))
      }
  })

  it('retains valid sid-less personal bearer creation admission', async () => {
    const legacy = context.app
      .get(JwtService)
      .sign({ sub: userId, email: 'creator@example.test', systemRole: 'USER' })
    await http().post('/organizations').auth(legacy, { type: 'bearer' }).send(intent).expect(201)
  })

  it('rejects an otherwise valid organization API key on personal creation and setup routes', async () => {
    const operationId = randomUUID()
    const org = await create(operationId).expect(201)
    const key = await http()
      .post('/api-keys')
      .auth(token, { type: 'bearer' })
      .send({ name: 'Establishment boundary', organizationId: org.body.id, scopes: ['read:User'] })
      .expect(201)
    await http().get('/auth/me').auth(key.body.key, { type: 'bearer' }).expect(200)
    await http()
      .post('/organizations')
      .auth(key.body.key, { type: 'bearer' })
      .send({ name: 'Forbidden' })
      .expect(401)
    for (const path of [
      '/organizations/creation-policy',
      `/organizations/creation-results/${operationId}`,
      '/admin/organization-establishment/status',
    ])
      await http().get(path).auth(key.body.key, { type: 'bearer' }).expect(401)
    expect(await context.prisma.organization.count()).toBe(1)
  })

  it('reports missing runtime lock privileges as a deployment prerequisite without granting anything', async () => {
    await context.prisma.$executeRawUnsafe('CREATE ROLE t044_read_only NOLOGIN')
    try {
      await context.prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA core TO t044_read_only')
      await context.prisma.$executeRawUnsafe(
        'GRANT SELECT ON ALL TABLES IN SCHEMA core TO t044_read_only'
      )
      const db: EstablishmentDatabase = {
        $transaction: (work: (tx: unknown) => unknown, options: unknown) =>
          context.prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL ROLE t044_read_only')
            return work(tx)
          }, options as never),
      } as EstablishmentDatabase
      await expect(
        new OrganizationSetupOperations(db, false).prepare({ email: 'denied@example.test' })
      ).rejects.toMatchObject({ errorCode: 'SETUP_NOT_READY' })
      expect(
        await context.prisma.user.count({ where: { emailCanonical: 'denied@example.test' } })
      ).toBe(0)
      expect(await context.prisma.organizationBootstrapResult.count()).toBe(0)
    } finally {
      await context.prisma.$executeRawUnsafe('DROP OWNED BY t044_read_only')
      await context.prisma.$executeRawUnsafe('DROP ROLE t044_read_only')
    }
  })

  it('initial setup prepares an ordinary account and closes preparation after atomic completion', async () => {
    const prepared = await setup().prepare({
      email: 'anna@example.test',
      locale: coerceSupportedLocale('ru'),
    })
    const user = await context.prisma.user.findUniqueOrThrow({ where: { id: prepared.userId } })
    expect(user).toMatchObject({
      systemRole: 'USER',
      passwordHash: null,
      emailVerified: false,
      locale: coerceSupportedLocale('ru'),
    })
    expect(await context.prisma.session.count({ where: { userId: user.id } })).toBe(0)
    expect(await context.prisma.orgMember.count({ where: { userId: user.id } })).toBe(0)
    const input = { ...intent, adminUserId: user.id }
    await expect(setup().bootstrap(input)).rejects.toMatchObject({
      errorCode: 'SETUP_EMAIL_UNVERIFIED',
    })
    // This fixture tests primary verified admission. The real generated-link journey has a separate mail/browser proof.
    await context.prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } })
    const result = await setup().bootstrap(input)
    expect(result.status).toBe('created')
    expect((await setup().bootstrap(input)).status).toBe('already_completed')
    await expect(setup().prepare({ email: 'another@example.test' })).rejects.toMatchObject({
      errorCode: 'SETUP_CLOSED',
    })
    await expect(setup().prepare({ email: 'anna@example.test' })).rejects.toMatchObject({
      errorCode: 'SETUP_CLOSED',
    })
    expect(
      await context.prisma.user.count({ where: { emailCanonical: 'another@example.test' } })
    ).toBe(0)
    expect((await setup().status()).state).toBe('completed-intact')
    expect(await context.prisma.orgMember.count({ where: { userId } })).toBe(0)
    expect(await context.prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({
      systemRole: 'USER',
    })
  })

  it('rejects preparation on nonempty/not-ready installations and preserves existing credentials', async () => {
    const original = await context.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const prepared = await setup().prepare({
      email: 'CREATOR@example.test',
      locale: coerceSupportedLocale('ru'),
    })
    expect(prepared).toMatchObject({ status: 'existing', userId })
    expect(await context.prisma.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(original)
    await expect(
      new OrganizationSetupOperations(context.prisma, true).prepare({
        email: 'blocked@example.test',
      })
    ).rejects.toMatchObject({ errorCode: 'SETUP_NOT_READY' })
    await create().expect(201)
    await expect(setup().prepare({ email: 'blocked@example.test' })).rejects.toMatchObject({
      errorCode: 'SETUP_CLOSED',
    })
    expect((await setup().status()).state).toBe('existing-org-without-receipt')
  })

  it('retains initial completion through deletion, refusing any automatic restoration', async () => {
    await context.prisma.user.update({ where: { id: userId }, data: { emailVerified: true } })
    const input = { ...intent, adminUserId: userId }
    const result = await setup().bootstrap(input)
    await context.prisma.organization.delete({ where: { id: result.ids.organizationId } })
    expect((await setup().status()).state).toBe('completed-changed')
    await expect(setup().bootstrap(input)).rejects.toMatchObject({
      errorCode: 'SETUP_STATE_CHANGED',
    })
    await expect(setup().prepare({ email: 'new@example.test' })).rejects.toMatchObject({
      errorCode: 'SETUP_CLOSED',
    })
    await context.prisma.user.delete({ where: { id: userId } })
    expect(await context.prisma.organizationBootstrapResult.count()).toBe(1)
    expect((await setup().status()).state).toBe('completed-changed')
  })

  it('protected setup requires live SUPER_ADMIN and fresh mutations, without adding operator membership', async () => {
    context.app.get(ConfigService).set('ORG_SELF_SERVICE_CREATION_ENABLED', false)
    const path = '/admin/organization-establishment'
    await http().get(`${path}/status`).auth(token, { type: 'bearer' }).expect(403)
    await context.prisma.user.update({ where: { id: userId }, data: { systemRole: 'SUPER_ADMIN' } })
    const login = await loginDomainOperator(context, {
      email: 'creator@example.test',
      password: 'StrongP@ss123',
    })
    token = login.body.accessToken
    await http()
      .get(`${path}/status`)
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => expect(body.state).toBe('eligible-empty'))
    const account = await http()
      .post(`${path}/accounts/prepare`)
      .auth(token, { type: 'bearer' })
      .send({ email: 'staff@example.test' })
      .expect(200)
    await context.prisma.user.update({
      where: { id: account.body.userId },
      data: { emailVerified: true },
    })
    await http()
      .post(`${path}/bootstrap`)
      .auth(token, { type: 'bearer' })
      .send({ ...intent, adminUserId: account.body.userId })
      .expect(200)
    await http()
      .post(`${path}/accounts/prepare`)
      .auth(token, { type: 'bearer' })
      .send({ email: 'new@example.test' })
      .expect(409)
    await http()
      .get(`${path}/accounts/${userId}/status`)
      .auth(token, { type: 'bearer' })
      .expect(409)
    expect(await context.prisma.orgMember.count({ where: { userId } })).toBe(0)
    const principal = context.app.get(JwtService).verify(token)
    await context.prisma.authSessionFamily.update({
      where: { id: principal.fid },
      data: { revokedAt: new Date() },
    })
    await http().get(`${path}/status`).auth(token, { type: 'bearer' }).expect(409)
  })
})
