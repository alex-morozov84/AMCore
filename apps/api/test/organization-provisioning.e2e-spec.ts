import { ConfigService } from '@nestjs/config'

import { DEFAULT_LOCALE } from '@amcore/shared'
import { createInvitationOperationId } from '@amcore/shared'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { prepareProvisioningFixture } from './provisioning-fixture'

describe('Operator organization provisioning (e2e)', () => {
  let context: E2ETestContext
  let fixture: Awaited<ReturnType<typeof prepareProvisioningFixture>>
  beforeAll(async () => {
    context = await setupE2ETest()
    await seedSystemRoles(context.prisma)
  }, 120000)
  afterAll(async () => {
    await teardownE2ETest(context)
  }, 120000)
  beforeEach(async () => {
    fixture = await prepareProvisioningFixture(context)
  })
  afterEach(() => {
    fixture?.restore()
  })

  it('atomically creates an org and ADMIN invitation without either membership, and exact replay never sends again', async () => {
    const input = fixture.input()
    const first = await fixture.create(input).expect(201)
    expect(await context.prisma.orgMember.count()).toBe(0)
    expect(await context.prisma.organizationProvisioning.count()).toBe(1)
    const invite = await context.prisma.orgInvite.findFirstOrThrow({
      include: { roleIntents: true },
    })
    expect(invite.roleIntents.map((role) => role.roleNameAtIssue)).toEqual(['ADMIN'])
    fixture.mail.clear()
    const replay = await fixture.create(input).expect(201)
    expect(replay.body).toEqual(first.body)
    expect(fixture.mail.size).toBe(0)
    expect(await context.prisma.organization.count()).toBe(1)
    await fixture.create({ ...input, name: 'Other' }).expect(409)
    expect((await fixture.status(first.body.organizationId).expect(200)).body).toMatchObject({
      state: 'awaiting',
      access: 'not_established',
      revision: 1,
    })
  })

  it('blocks known production mock before writes but preserves read, replay and cancellation', async () => {
    const input = fixture.input()
    const created = await fixture.create(input).expect(201)
    context.app.get(ConfigService).set('NODE_ENV', 'production')
    await fixture.create(fixture.input({ slug: 'blocked' })).expect(503)
    expect(await context.prisma.organization.count()).toBe(1)
    await fixture.create(input).expect(201)
    await fixture.status(created.body.organizationId).expect(200)
    await fixture
      .recover(created.body.organizationId, 'reissue', {
        operationId: createInvitationOperationId(),
        expectedRevision: 1,
        expectedInviteId: (await context.prisma.orgInvite.findFirstOrThrow()).id,
        expectedGeneration: 1,
      })
      .expect(503)
    await fixture
      .recover(created.body.organizationId, 'cancel', {
        operationId: createInvitationOperationId(),
        expectedRevision: 1,
      })
      .expect(200)
  })

  it('requires live personal SUPER_ADMIN and strict DTO, without changing signup/create policies', async () => {
    await fixture.http().post('/admin/organization-provisionings').send(fixture.input()).expect(401)
    const user = await fixture
      .http()
      .post('/auth/register')
      .send({ email: 'buyer@e2e.amcore.test', password: 'StrongP@ss123' })
      .expect(201)
    await fixture
      .http()
      .post('/admin/organization-provisionings')
      .auth(user.body.accessToken, { type: 'bearer' })
      .send(fixture.input())
      .expect(403)
    await fixture.create({ ...fixture.input(), roleIds: ['ADMIN'] } as never).expect(400)
    expect(await context.prisma.orgMember.count()).toBe(0)
  })

  it('keeps a readable permanent result after organization and original operator deletion', async () => {
    const input = fixture.input()
    const first = await fixture.create(input).expect(201)
    await context.prisma.organization.delete({ where: { id: first.body.organizationId } })
    await fixture.create(input).expect(201)
    expect((await fixture.status(first.body.organizationId).expect(200)).body.available).toBe(false)
    expect(await context.prisma.organization.count()).toBe(0)
    await context.prisma.user.delete({ where: { id: fixture.operatorId } })
    expect(await context.prisma.organizationProvisioning.count()).toBe(1)
  })

  it('replaces the recipient in the same organization and rejects a stale action revision', async () => {
    const created = await fixture.create().expect(201)
    const orgId = created.body.organizationId
    const original = await context.prisma.orgInvite.findFirstOrThrow()
    await fixture
      .recover(orgId, 'replace-recipient', {
        operationId: createInvitationOperationId(),
        expectedRevision: 1,
        firstAdminEmail: 'correct@e2e.amcore.test',
        inviteLocale: DEFAULT_LOCALE,
      })
      .expect(200)
    expect(await context.prisma.organization.count()).toBe(1)
    expect(
      (await context.prisma.orgInvite.findUniqueOrThrow({ where: { id: original.id } })).revokedAt
    ).not.toBeNull()
    await fixture
      .recover(orgId, 'cancel', { operationId: createInvitationOperationId(), expectedRevision: 1 })
      .expect(409)
    expect((await fixture.status(orgId).expect(200)).body.invite.email).toBe(
      'correct@e2e.amcore.test'
    )
  })
})
