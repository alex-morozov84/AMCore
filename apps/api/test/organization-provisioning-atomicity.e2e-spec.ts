import { createInvitationOperationId } from '@amcore/shared'

import { type E2ETestContext,seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { invitationFence } from './helpers/invitation-race'
import { prepareProvisioningFixture, prepareProvisioningRecipient } from './provisioning-fixture'

describe('Provisioning atomic writes (e2e)', () => {
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
  })

  it.each(['orgInvite', 'organizationProvisioning', 'auditLog'])(
    'rolls back creation after %s write failure',
    async (model) => {
      const fault = invitationFence(context.prisma, (name, method) => {
        if (name === model && method === 'create') throw new Error('Controlled write failure')
        return false
      })
      try {
        await fixture.create().expect(503)
        expect(await context.prisma.organization.count()).toBe(0)
        expect(await context.prisma.orgInvite.count()).toBe(0)
        expect(await context.prisma.organizationProvisioning.count()).toBe(0)
        expect(fixture.mail.size).toBe(0)
        expect(await context.prisma.auditLog.count({ where: { action: 'org.created' } })).toBe(0)
      } finally {
        fault.restore()
      }
    }
  )

  it('rolls back acceptance, membership and proof when completion audit fails', async () => {
    await fixture.create().expect(201)
    const actor = await prepareProvisioningRecipient(context, fixture)
    const before = await context.prisma.organizationProvisioning.findFirstOrThrow()
    const fault = invitationFence(context.prisma, (model, method, args) => {
      const input = args[0] as { data?: { action?: string } }
      if (
        model === 'auditLog' &&
        method === 'create' &&
        input.data?.action === 'org.provisioning_completed'
      )
        throw new Error('Controlled completion audit failure')
      return false
    })
    try {
      await actor.accept().expect(503)
      expect(await context.prisma.orgMember.count()).toBe(0)
      expect(await context.prisma.organizationProvisioning.findFirstOrThrow()).toEqual(before)
      expect(
        (await context.prisma.orgInvite.findUniqueOrThrow({ where: { id: actor.inviteId } }))
          .acceptedAt
      ).toBeNull()
      expect(
        await context.prisma.auditLog.count({ where: { action: 'org.provisioning_completed' } })
      ).toBe(0)
    } finally {
      fault.restore()
    }
    await actor.accept().expect(200)
  })

  it('rolls back replacement and its receipt when audit fails', async () => {
    const created = await fixture.create().expect(201)
    const before = await context.prisma.organizationProvisioning.findFirstOrThrow()
    const invite = await context.prisma.orgInvite.findUniqueOrThrow({
      where: { id: before.currentInviteId! },
    })
    const operationId = createInvitationOperationId()
    const fault = invitationFence(context.prisma, (model, method, args) => {
      const input = args[0] as { data?: { action?: string } }
      if (
        model === 'auditLog' &&
        method === 'create' &&
        input.data?.action === 'org.provisioning_replace'
      )
        throw new Error('Controlled recovery audit failure')
      return false
    })
    try {
      await fixture
        .recover(created.body.organizationId, 'replace-recipient', {
          operationId,
          expectedRevision: 1,
          firstAdminEmail: 'replacement@e2e.amcore.test',
        })
        .expect(503)
      expect(await context.prisma.organizationProvisioning.findFirstOrThrow()).toEqual(before)
      expect(
        await context.prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })
      ).toEqual(invite)
      expect(await context.prisma.orgInvite.count()).toBe(1)
      expect(await context.prisma.invitationOperation.count({ where: { operationId } })).toBe(0)
      expect(fixture.mail.has('replacement@e2e.amcore.test')).toBe(false)
    } finally {
      fault.restore()
    }
  })
})
