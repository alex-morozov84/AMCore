import { DEFAULT_LOCALE } from '@amcore/shared'
import { createInvitationOperationId } from '@amcore/shared'

import { InvitationRetentionService } from '../src/core/invitations/invitation-retention.service'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { prepareProvisioningFixture, prepareProvisioningRecipient } from './provisioning-fixture'

describe('First administrator settlement and retention (e2e)', () => {
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

  const recipient = () => prepareProvisioningRecipient(context, fixture)

  it('grants actual ADMIN atomically and preserves proof when grant and invitation disappear before first status GET', async () => {
    const created = await fixture.create().expect(201)
    const actor = await recipient()
    expect((await actor.inspect().expect(200)).body.state).toBe('ready')
    await actor.accept().expect(200)
    const row = await context.prisma.organizationProvisioning.findFirstOrThrow()
    expect(row.state).toBe('completed')
    expect(row.originalAdminUserId).toBe(actor.id)
    expect(
      await context.prisma.memberRole.count({ where: { id: row.originalAdminGrantId! } })
    ).toBe(1)
    const switched = await fixture
      .http()
      .post(`/organizations/${created.body.organizationId}/switch`)
      .auth(actor.token, { type: 'bearer' })
      .expect(200)
    await fixture
      .http()
      .get(`/organizations/${created.body.organizationId}/members`)
      .auth(switched.body.accessToken, { type: 'bearer' })
      .expect(200)
    await context.prisma.memberRole.delete({ where: { id: row.originalAdminGrantId! } })
    await context.prisma.orgInvite.update({
      where: { id: actor.inviteId },
      data: { acceptedAt: new Date(Date.now() - 31 * 86_400_000) },
    })
    await context.app.get(InvitationRetentionService).prune('terminal')
    const status = await fixture.status(created.body.organizationId).expect(200)
    expect(status.body).toMatchObject({ state: 'completed', access: 'removed', invite: null })
    await fixture
      .recover(created.body.organizationId, 'replace-recipient', {
        operationId: createInvitationOperationId(),
        expectedRevision: status.body.revision,
        firstAdminEmail: 'other@e2e.amcore.test',
      })
      .expect(409)
    expect(
      await context.prisma.memberRole.count({ where: { id: row.originalAdminGrantId! } })
    ).toBe(0)
  })

  it.each(['ADMIN', 'MEMBER'])(
    'requires explicit B07 consent for an existing %s and never elevates MEMBER',
    async (roleName) => {
      const created = await fixture.create().expect(201)
      const actor = await recipient()
      const role = await context.prisma.role.findFirstOrThrow({
        where: { name: roleName, organizationId: null },
      })
      const member = await context.prisma.orgMember.create({
        data: { userId: actor.id, organizationId: created.body.organizationId },
      })
      const grant = await context.prisma.memberRole.create({
        data: { memberId: member.id, roleId: role.id },
      })
      const isAdmin = roleName === 'ADMIN'
      const inspected = await actor.inspect()
      expect(inspected.status).toBe(isAdmin ? 200 : 409)
      expect(inspected.body.state).toBe(isAdmin ? 'ready' : undefined)
      const accepted = await actor.accept()
      expect(accepted.status).toBe(isAdmin ? 200 : 409)
      expect(accepted.body.status).toBe(isAdmin ? 'already_access' : undefined)
      const current = await context.prisma.organizationProvisioning.findFirstOrThrow()
      expect(current.state).toBe(isAdmin ? 'completed' : 'awaiting')
      expect(current.originalAdminGrantId).toBe(isAdmin ? grant.id : null)
      const invitation = await context.prisma.orgInvite.findUniqueOrThrow({
        where: { id: actor.inviteId },
      })
      expect(invitation.acceptedAt instanceof Date).toBe(isAdmin)
      expect(await context.prisma.memberRole.count({ where: { memberId: member.id } })).toBe(1)
    }
  )

  it('recovers pending invitation pruning with explicit recipient entry for the same organization', async () => {
    const created = await fixture.create().expect(201)
    await context.prisma.orgInvite.updateMany({
      data: { expiresAt: new Date(Date.now() - 31 * 86_400_000) },
    })
    await context.app.get(InvitationRetentionService).prune('pending')
    const status = await fixture.status(created.body.organizationId).expect(200)
    expect(status.body).toMatchObject({ state: 'awaiting', invite: null, revision: 2 })
    await fixture
      .recover(created.body.organizationId, 'replace-recipient', {
        operationId: createInvitationOperationId(),
        expectedRevision: 2,
        firstAdminEmail: 'recovered@e2e.amcore.test',
        inviteLocale: DEFAULT_LOCALE,
      })
      .expect(200)
    expect(await context.prisma.organization.count()).toBe(1)
    expect((await fixture.status(created.body.organizationId).expect(200)).body.invite.email).toBe(
      'recovered@e2e.amcore.test'
    )
  })
})
