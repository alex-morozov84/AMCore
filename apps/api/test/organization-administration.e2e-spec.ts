import { ConfigService } from '@nestjs/config'

import { DEFAULT_LOCALE } from '@amcore/shared'
import { createInvitationOperationId } from '@amcore/shared'

import { InvitationRetentionService } from '../src/core/invitations/invitation-retention.service'
import { InvitationEmailService } from '../src/core/organizations/invitation-email.service'
import type { Prisma } from '../src/generated/prisma/client'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { invitationFence } from './helpers/invitation-race'
import { prepareProvisioningFixture, prepareProvisioningRecipient } from './provisioning-fixture'

const reason = 'Support request TEST-49'
describe('Platform organization administration (e2e)', () => {
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
  afterEach(() => fixture.restore())
  const post = (orgId: string, path: string, body: object) =>
    fixture
      .http()
      .post(`/admin/organizations/${orgId}/${path}`)
      .auth(fixture.token, { type: 'bearer' })
      .send(body)
  const summary = (id: string) =>
    fixture
      .http()
      .get(`/admin/organizations/${id}/administration`)
      .auth(fixture.token, { type: 'bearer' })
  const attention = () =>
    fixture.http().get('/admin/organizations/attention').auth(fixture.token, { type: 'bearer' })
  async function cancelled() {
    const created = await fixture.create().expect(201)
    await fixture
      .recover(created.body.organizationId, 'cancel', {
        operationId: createInvitationOperationId(),
        expectedRevision: 1,
      })
      .expect(200)
    return created.body.organizationId as string
  }
  const invite = (orgId: string, email = 'other@e2e.amcore.test') =>
    post(orgId, 'administrator-invitations', {
      operationId: createInvitationOperationId(),
      email,
      inviteLocale: DEFAULT_LOCALE,
      reason,
    })
  it('keeps cancelled initial history terminal while a new invitation is independently replayable', async () => {
    const id = await cancelled()
    const body = {
      operationId: createInvitationOperationId(),
      email: 'other@e2e.amcore.test',
      reason,
    }
    const created = await post(id, 'administrator-invitations', body).expect(201)
    const before = await context.prisma.organizationAdministratorInvitation.findUniqueOrThrow({
      where: { id: body.operationId },
    })
    fixture.mail.clear()
    expect((await post(id, 'administrator-invitations', body).expect(201)).body).toEqual(
      created.body
    )
    expect(fixture.mail.size).toBe(0)
    expect(
      await context.prisma.organizationAdministratorInvitation.findUniqueOrThrow({
        where: { id: body.operationId },
      })
    ).toEqual(before)
    expect((await fixture.status(id).expect(200)).body.state).toBe('cancelled')
    expect(await context.prisma.orgMember.count({ where: { userId: fixture.operatorId } })).toBe(0)
    expect(JSON.stringify((await summary(id).expect(200)).body)).not.toContain(reason)
    expect(
      (
        await context.prisma.auditLog.findFirstOrThrow({
          where: { action: 'org.administrator_invitation_created' },
        })
      ).metadata
    ).toMatchObject({ reason })
    await post(id, 'administrator-invitations', { ...body, reason: 'Changed input' }).expect(409)
  })
  it('counts all awaiting intents, including expired and pruned invitations, and keeps no-admin orgs visible', async () => {
    const id = await cancelled()
    const first = await invite(id).expect(201)
    await invite(id, 'second@e2e.amcore.test').expect(201)
    let row = (await attention().expect(200)).body.data[0]
    expect(row).toMatchObject({ organizationId: id, adminCount: 0, pendingAdminInvitationCount: 2 })
    await context.prisma.orgInvite.updateMany({
      where: { organizationId: id },
      data: { expiresAt: new Date(Date.now() - 31 * 86400000) },
    })
    expect((await attention().expect(200)).body.data[0].reasons).toContain('expired')
    await context.app.get(InvitationRetentionService).prune('pending')
    row = (await attention().expect(200)).body.data[0]
    expect(row.pendingAdminInvitationCount).toBe(2)
    expect(row.reasons).toContain('recipient_required')
    const progress = (await summary(id).expect(200)).body.invitations.data.find(
      (x: { id: string }) => x.id === first.body.administratorInvitationId
    )
    expect(progress).toMatchObject({ revision: 2, invite: null })
    await post(id, `administrator-invitations/${progress.id}/replace-recipient`, {
      operationId: createInvitationOperationId(),
      expectedRevision: 2,
      email: 'recovered@e2e.amcore.test',
      reason,
    }).expect(200)
    expect((await attention().expect(200)).body.data[0].pendingAdminInvitationCount).toBe(2)
  })
  it('refuses new additional invites during initial awaiting and requires a personal operator', async () => {
    const created = await fixture.create().expect(201)
    const id = created.body.organizationId
    await invite(id)
      .expect(409)
      .expect((res) => expect(res.body.errorCode).toBe('ADMIN_INITIAL_SETUP_PENDING'))
    await fixture.http().get(`/admin/organizations/${id}/administration`).expect(401)
    const recipient = await prepareProvisioningRecipient(context, fixture)
    await fixture
      .http()
      .get(`/admin/organizations/${id}/administration`)
      .auth(recipient.token, { type: 'bearer' })
      .expect(403)
  })
  it('adds ADMIN explicitly to a verified member, preserves MEMBER and replays without regranting removed rights', async () => {
    const created = await fixture.create().expect(201)
    const id = created.body.organizationId
    const recipient = await prepareProvisioningRecipient(context, fixture)
    const memberRole = await context.prisma.role.findFirstOrThrow({
      where: { name: 'MEMBER', organizationId: null },
    })
    const member = await context.prisma.orgMember.create({
      data: {
        userId: recipient.id,
        organizationId: id,
        roles: { create: { roleId: memberRole.id } },
      },
    })
    const body = {
      operationId: createInvitationOperationId(),
      userId: recipient.id,
      expectedMemberId: member.id,
      expectedAclVersion: 0,
      reason,
    }
    const assigned = await post(id, 'administrators', body).expect(200)
    expect(assigned.body.changed).toBe(true)
    expect(await context.prisma.memberRole.count({ where: { memberId: member.id } })).toBe(2)
    expect((await fixture.status(id).expect(200)).body).toMatchObject({
      state: 'completed',
      access: 'original_grant_present',
    })
    expect((await summary(id).expect(200)).body.administrators.total).toBe(1)
    expect((await attention().expect(200)).body.total).toBe(0)
    await context.prisma.memberRole.delete({ where: { id: assigned.body.adminGrantId } })
    expect((await post(id, 'administrators', body).expect(200)).body).toEqual(assigned.body)
    expect(await context.prisma.memberRole.count({ where: { memberId: member.id } })).toBe(1)
    expect((await attention().expect(200)).body.data[0]).toMatchObject({
      adminCount: 0,
      pendingAdminInvitationCount: 0,
    })
  })
  it('accepts a new invitation after initial cancellation and preserves both actual ADMINs', async () => {
    const id = await cancelled()
    await invite(id, 'admin@e2e.amcore.test').expect(201)
    const recipient = await prepareProvisioningRecipient(context, fixture)
    await recipient.accept().expect(200)
    expect((await summary(id).expect(200)).body.administrators.total).toBe(1)
    const initial = await context.prisma.organizationProvisioning.findFirstOrThrow()
    expect(initial.state).toBe('cancelled')
    expect(
      (await context.prisma.organizationAdministratorInvitation.findFirstOrThrow()).state
    ).toBe('completed')
    expect((await attention().expect(200)).body.total).toBe(0)
    // Another explicit operator action can add a verified current member without altering the first ADMIN.
    const user = await context.prisma.user.create({
      data: {
        email: 'second@e2e.amcore.test',
        emailCanonical: 'second@e2e.amcore.test',
        emailVerified: true,
      },
    })
    const member = await context.prisma.orgMember.create({
      data: { userId: user.id, organizationId: id },
    })
    const current = (await summary(id).expect(200)).body
    await post(id, 'administrators', {
      operationId: createInvitationOperationId(),
      userId: user.id,
      expectedMemberId: member.id,
      expectedAclVersion: current.aclVersion,
      reason,
    }).expect(200)
    expect((await summary(id).expect(200)).body.administrators.total).toBe(2)
  })
  it('rolls back actual grant, ACL, initial proof and receipt when the sanctioned security audit fails', async () => {
    const created = await fixture.create().expect(201)
    const id = created.body.organizationId
    const recipient = await prepareProvisioningRecipient(context, fixture)
    const member = await context.prisma.orgMember.create({
      data: { userId: recipient.id, organizationId: id },
    })
    const before = await context.prisma.organizationProvisioning.findFirstOrThrow()
    const operationId = createInvitationOperationId()
    const fault = invitationFence(context.prisma, (model, method, args) => {
      if (
        model === 'auditLog' &&
        method === 'create' &&
        (args[0] as { data?: { action?: string } }).data?.action === 'org.administrator_assigned'
      )
        throw new Error('Controlled audit failure')
      return false
    })
    try {
      await post(id, 'administrators', {
        operationId,
        userId: recipient.id,
        expectedMemberId: member.id,
        expectedAclVersion: 0,
        reason,
      }).expect(503)
      expect(await context.prisma.memberRole.count({ where: { memberId: member.id } })).toBe(0)
      expect(
        (await context.prisma.organization.findUniqueOrThrow({ where: { id } })).aclVersion
      ).toBe(0)
      expect(await context.prisma.organizationProvisioning.findFirstOrThrow()).toEqual(before)
      expect(await context.prisma.invitationOperation.count({ where: { operationId } })).toBe(0)
    } finally {
      fault.restore()
    }
  })
  it('refuses stale membership, unverified identity and production mock sends without creating intents', async () => {
    const id = await cancelled()
    const user = await context.prisma.user.create({
      data: { email: 'member@e2e.amcore.test', emailCanonical: 'member@e2e.amcore.test' },
    })
    const member = await context.prisma.orgMember.create({
      data: { userId: user.id, organizationId: id },
    })
    const body = {
      operationId: createInvitationOperationId(),
      userId: user.id,
      expectedMemberId: member.id,
      expectedAclVersion: 0,
      reason,
    }
    await post(id, 'administrators', body)
      .expect(409)
      .expect((res) => expect(res.body.errorCode).toBe('ADMIN_MEMBER_UNVERIFIED'))
    await context.prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } })
    await post(id, 'administrators', {
      ...body,
      operationId: createInvitationOperationId(),
      expectedMemberId: 'stale-member',
    }).expect(409)
    await post(id, 'administrators', {
      ...body,
      operationId: createInvitationOperationId(),
      expectedAclVersion: 9,
    }).expect(409)
    context.app.get(ConfigService).set('NODE_ENV', 'production')
    await invite(id)
      .expect(503)
      .expect((res) => expect(res.body.errorCode).toBe('PROVISIONING_EMAIL_NOT_CONFIGURED'))
    expect(await context.prisma.organizationAdministratorInvitation.count()).toBe(0)
    expect(await context.prisma.memberRole.count({ where: { memberId: member.id } })).toBe(0)
  })

  it('shares the original mail quota with additional invitations and rolls back a rejected reissue', async () => {
    const id = await cancelled() // Original invite already consumed one unit for admin@.
    const created = await invite(id, 'admin@e2e.amcore.test').expect(201)
    const intentId = created.body.administratorInvitationId
    await post(id, `administrator-invitations/${intentId}/reissue`, {
      operationId: createInvitationOperationId(),
      expectedRevision: 1,
      expectedInviteId: (await summary(id)).body.invitations.data[0].invite.id,
      expectedGeneration: 1,
      reason,
    }).expect(200)
    const current = (await summary(id).expect(200)).body.invitations.data[0]
    await post(id, `administrator-invitations/${intentId}/reissue`, {
      operationId: createInvitationOperationId(),
      expectedRevision: current.revision,
      expectedInviteId: current.invite.id,
      expectedGeneration: current.invite.generation,
      reason,
    }).expect(429)
    expect((await summary(id).expect(200)).body.invitations.data[0]).toEqual(current)
  })
  it('recovers a committed create after lost acknowledgment without sending email automatically', async () => {
    const id = await cancelled()
    const input = {
      operationId: createInvitationOperationId(),
      email: 'other@e2e.amcore.test',
      reason,
    }
    const original = context.prisma.$transaction.bind(context.prisma)
    const fault = import.meta.jest
      .spyOn(context.prisma, '$transaction')
      .mockImplementationOnce((async (
        work: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: object
      ) => {
        await original(work, options)
        throw new Error('Controlled acknowledgment loss after COMMIT')
      }) as never)
    fixture.mail.clear()
    try {
      await post(id, 'administrator-invitations', input).expect(503)
    } finally {
      fault.mockRestore()
    }
    expect(await context.prisma.organizationAdministratorInvitation.count()).toBe(1)
    const recovered = await fixture
      .http()
      .get(`/admin/organizations/${id}/administrator-operations/${input.operationId}`)
      .auth(fixture.token, { type: 'bearer' })
      .expect(200)
    expect(recovered.body.state).toBe('committed')
    await post(id, 'administrator-invitations', input).expect(201)
    expect(fixture.mail.size).toBe(0)
    expect(
      await context.prisma.auditLog.count({
        where: { action: 'org.administrator_invitation_created', organizationId: id },
      })
    ).toBe(1)
  })
  it('cannot rewrite terminal mail facts when a provider acknowledges an older attempt late', async () => {
    const id = await cancelled()
    let release!: () => void
    let entered!: () => void
    const arrived = new Promise<void>((resolve) => {
      entered = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const dispatch = import.meta.jest
      .spyOn(context.app.get(InvitationEmailService), 'dispatch')
      .mockImplementationOnce(async () => {
        entered()
        await barrier
      })
    let pending: Promise<unknown> | undefined
    try {
      pending = invite(id).then((response) => {
        expect(response.status).toBe(201)
      })
      await arrived
      const row = await context.prisma.organizationAdministratorInvitation.findFirstOrThrow()
      await post(id, `administrator-invitations/${row.id}/cancel`, {
        operationId: createInvitationOperationId(),
        expectedRevision: 1,
        reason,
      }).expect(200)
      release()
      await pending
      expect(
        await context.prisma.organizationAdministratorInvitation.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).toMatchObject({
        state: 'cancelled',
        mailOutcome: null,
        attemptId: null,
        currentInviteId: null,
      })
    } finally {
      release()
      await Promise.allSettled([pending])
      dispatch.mockRestore()
    }
  })
})
