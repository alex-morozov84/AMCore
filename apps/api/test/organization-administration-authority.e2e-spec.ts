import { createInvitationOperationId } from '@amcore/shared'

import { deleteOwnedFamilies } from '../src/core/auth/session-revocation.js'
import { ProvisioningLimiterService } from '../src/core/organizations/provisioning/provisioning-limiter.service'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { invitationFence } from './helpers/invitation-race'
import { prepareManagedInvitation } from './managed-invitation-fixture'
import { prepareProvisioningFixture, prepareProvisioningRecipient } from './provisioning-fixture'

describe('Administrator authority after transaction waits (e2e)', () => {
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
    fixture.restore()
    import.meta.jest.restoreAllMocks()
  })
  it('rejects a revoked operator session after Redis admission without new intent, invitation, receipt or audit', async () => {
    const { orgId } = await prepareManagedInvitation(context, fixture, 'additional')
    const before = await context.prisma.organizationAdministratorInvitation.findMany({
      where: { organizationId: orgId },
    })
    const invites = await context.prisma.orgInvite.count({ where: { organizationId: orgId } })
    const operationId = createInvitationOperationId()
    const admission = import.meta.jest
      .spyOn(context.app.get(ProvisioningLimiterService), 'consume')
      .mockImplementationOnce(async () => {
        await deleteOwnedFamilies(context.prisma, fixture.operatorId)
      })
    try {
      const response = await fixture
        .http()
        .post(`/admin/organizations/${orgId}/administrator-invitations`)
        .auth(fixture.token, { type: 'bearer' })
        .send({ operationId, email: 'another@e2e.amcore.test', reason: 'TEST-49 session boundary' })
      expect(response.status).toBe(409)
      expect(response.body.errorCode).toBe('SESSION_CHANGED')
      expect(
        await context.prisma.organizationAdministratorInvitation.findMany({
          where: { organizationId: orgId },
        })
      ).toEqual(before)
      expect(await context.prisma.orgInvite.count({ where: { organizationId: orgId } })).toBe(
        invites
      )
      expect(await context.prisma.invitationOperation.count({ where: { operationId } })).toBe(0)
      expect(
        await context.prisma.organizationAdministratorInvitation.count({
          where: { id: operationId },
        })
      ).toBe(0)
      expect(
        await context.prisma.auditLog.count({
          where: {
            organizationId: orgId,
            metadata: { path: ['operationId'], equals: operationId },
          },
        })
      ).toBe(0)
    } finally {
      admission.mockRestore()
    }
  })
  it('rechecks session after exact member locking and never commits a grant or completion proof on revocation', async () => {
    const created = await fixture.create().expect(201)
    const orgId: string = created.body.organizationId
    const recipient = await prepareProvisioningRecipient(context, fixture)
    const member = await context.prisma.orgMember.create({
      data: { userId: recipient.id, organizationId: orgId },
    })
    const initial = await context.prisma.organizationProvisioning.findFirstOrThrow()
    const operationId = createInvitationOperationId()
    const fence = invitationFence(
      context.prisma,
      (model, method, args) =>
        model === '$sql' &&
        method === '$queryRaw' &&
        String(args[0]).includes('SELECT id FROM core.org_members')
    )
    let pending: Promise<unknown> | undefined
    try {
      const request = fixture
        .http()
        .post(`/admin/organizations/${orgId}/administrators`)
        .auth(fixture.token, { type: 'bearer' })
        .send({
          operationId,
          userId: recipient.id,
          expectedMemberId: member.id,
          expectedAclVersion: 0,
          reason: 'TEST-49 post-wait admission',
        })
        .then((response) => response)
      pending = request
      await fence.waitFor(request)
      await deleteOwnedFamilies(context.prisma, fixture.operatorId)
      fence.release()
      const response = await request
      expect(response.status).toBe(409)
      expect(response.body.errorCode).toBe('SESSION_CHANGED')
      expect(await context.prisma.memberRole.count({ where: { memberId: member.id } })).toBe(0)
      expect(
        (await context.prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).aclVersion
      ).toBe(0)
      expect(await context.prisma.organizationProvisioning.findFirstOrThrow()).toEqual(initial)
      expect(await context.prisma.invitationOperation.count({ where: { operationId } })).toBe(0)
    } finally {
      fence.restore()
      await Promise.allSettled([pending])
    }
  })
})
