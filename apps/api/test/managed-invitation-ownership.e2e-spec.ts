import { createInvitationOperationId } from '@amcore/shared'

import { InviteRateLimiterService } from '../src/core/organizations/invite-rate-limiter.service'

import { type E2ETestContext, seedSystemRoles, setupE2ETest, teardownE2ETest } from './helpers'
import { prepareManagedInvitation } from './managed-invitation-fixture'
import { prepareProvisioningFixture } from './provisioning-fixture'

describe('Both managed administrator invitation owners (e2e)', () => {
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
  const prepare = (kind: 'initial' | 'additional') =>
    prepareManagedInvitation(context, fixture, kind)
  async function snapshot(orgId: string) {
    return {
      invites: await context.prisma.orgInvite.findMany({
        where: { organizationId: orgId },
        include: { roleIntents: true },
        orderBy: { id: 'asc' },
      }),
      initial: await context.prisma.organizationProvisioning.findMany({
        where: { organizationId: orgId },
      }),
      additional: await context.prisma.organizationAdministratorInvitation.findMany({
        where: { organizationId: orgId },
        orderBy: { id: 'asc' },
      }),
      receipts: await context.prisma.invitationOperation.findMany({
        where: { organizationId: orgId },
        orderBy: { id: 'asc' },
      }),
      grants: await context.prisma.memberRole.findMany({
        where: { member: { organizationId: orgId } },
        orderBy: { id: 'asc' },
      }),
      audit: await context.prisma.auditLog.findMany({
        where: { organizationId: orgId },
        orderBy: { id: 'asc' },
      }),
    }
  }
  it.each(['initial', 'additional'] as const)(
    'blocks fresh ordinary email create, both reissue modes and revoke before quota for %s',
    async (kind) => {
      const { orgId, token, current, roleId } = await prepare(kind)
      // First prove authority through the ordinary protected read; an auth denial must not mask the guard.
      await fixture
        .http()
        .get(`/organizations/${orgId}/invites`)
        .auth(token, { type: 'bearer' })
        .expect(200)
      const quota = import.meta.jest.spyOn(context.app.get(InviteRateLimiterService), 'consume')
      const before = await snapshot(orgId)
      const mails = fixture.mail.size
      const root = `/organizations/${orgId}/invites`
      const commands = [
        () =>
          fixture
            .http()
            .post(root)
            .send({ email: current.email.toUpperCase(), roleIds: [roleId] }),
        () =>
          fixture
            .http()
            .post(`${root}/${current.id}/reissue`)
            .send({ expectedGeneration: current.generation, mode: 'repeat' }),
        () =>
          fixture
            .http()
            .post(`${root}/${current.id}/reissue`)
            .send({ expectedGeneration: current.generation, mode: 'replace', roleIds: [roleId] }),
        () =>
          fixture.http().delete(`${root}/${current.id}?expectedGeneration=${current.generation}`),
      ]
      for (const command of commands) {
        const response = await command()
          .auth(token, { type: 'bearer' })
          .set('X-Invitation-Operation-Id', createInvitationOperationId())
        expect(response.status).toBe(409)
        expect(response.body.errorCode).toBe('PROVISIONING_MANAGED')
        expect(await snapshot(orgId)).toEqual(before)
      }
      expect(quota).not.toHaveBeenCalled()
      expect(fixture.mail.size).toBe(mails)
      await context.prisma.orgInvite.update({
        where: { id: current.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      await fixture
        .http()
        .delete(`${root}/${current.id}?expectedGeneration=${current.generation}`)
        .auth(token, { type: 'bearer' })
        .set('X-Invitation-Operation-Id', createInvitationOperationId())
        .expect(409)
      expect(quota).not.toHaveBeenCalled()
    }
  )
  it.each(['initial', 'additional'] as const)(
    'preserves committed ordinary replay before the %s guard and keeps unmarked controls usable',
    async (kind) => {
      const { orgId, token, roleId } = await prepare(kind)
      const root = `/organizations/${orgId}/invites`
      const email = 'ordinary@e2e.amcore.test'
      const createId = createInvitationOperationId()
      const create = () =>
        fixture
          .http()
          .post(root)
          .auth(token, { type: 'bearer' })
          .set('X-Invitation-Operation-Id', createId)
          .send({ email, roleIds: [roleId] })
      await create().expect(202)
      let ordinary = await context.prisma.orgInvite.findFirstOrThrow({
        where: { organizationId: orgId, emailCanonical: email },
      })
      const reissueId = createInvitationOperationId()
      const reissueBody = { expectedGeneration: ordinary.generation, mode: 'repeat' }
      const reissue = () =>
        fixture
          .http()
          .post(`${root}/${ordinary.id}/reissue`)
          .auth(token, { type: 'bearer' })
          .set('X-Invitation-Operation-Id', reissueId)
          .send(reissueBody)
      await reissue().expect(202)
      ordinary = await context.prisma.orgInvite.findUniqueOrThrow({ where: { id: ordinary.id } })
      const revokeId = createInvitationOperationId()
      const revoke = () =>
        fixture
          .http()
          .delete(`${root}/${ordinary.id}?expectedGeneration=${ordinary.generation}`)
          .auth(token, { type: 'bearer' })
          .set('X-Invitation-Operation-Id', revokeId)
      await revoke().expect(204)
      // Controlled fixture: the owner now marks this retained link. Committed receipts must remain read-only even for inconsistent managed pointers.
      if (kind === 'initial')
        await context.prisma.organizationProvisioning.updateMany({
          where: { organizationId: orgId },
          data: { currentInviteId: ordinary.id, currentGeneration: ordinary.generation },
        })
      else
        await context.prisma.organizationAdministratorInvitation.updateMany({
          where: { organizationId: orgId },
          data: { currentInviteId: ordinary.id, currentGeneration: ordinary.generation },
        })
      const before = await snapshot(orgId)
      const quota = import.meta.jest.spyOn(context.app.get(InviteRateLimiterService), 'consume')
      fixture.mail.clear()
      await create().expect(202)
      await reissue().expect(202)
      await revoke().expect(204)
      expect(await snapshot(orgId)).toEqual(before)
      expect(quota).not.toHaveBeenCalled()
      expect(fixture.mail.size).toBe(0)
    }
  )
})
