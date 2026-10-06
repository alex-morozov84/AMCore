import request from 'supertest'

import { createInvitationOperationId } from '@amcore/shared'

import { invitationActor } from '../../src/core/organizations/invitation-actor'
import { InviteRateLimiterService } from '../../src/core/organizations/invite-rate-limiter.service'
import { EmailService } from '../../src/infrastructure/email'
import { seedOrgMember } from '../helpers'
import { invitationJwt } from '../helpers/invitation-http'
import type { InvitationProofFixture } from '../helpers/invitation-proof'
const jest = import.meta.jest

export function registerIssuanceBudgetProofs(getFixture: () => InvitationProofFixture): void {
  it('PD02 fresh create/repeat/replace share target budget; exhausted replay has no new effects', async () => {
    const { context, prisma, invites, orgId, recipient, actor, roleId } = getFixture()
    const delivery = jest.spyOn(context.app.get(EmailService), 'sendOrgInviteEmail').mockResolvedValue(undefined as never)
    try {
      const id = createInvitationOperationId()
      await invites.createInvite(orgId, { email: recipient.email! }, actor(), id)
      const row = await prisma.orgInvite.findFirstOrThrow({ where: { organizationId: orgId, emailCanonical: recipient.email! } })
      const repeatId = createInvitationOperationId()
      await invites.reissueInvite(orgId, row.id, { mode: 'repeat', expectedGeneration: 1 }, actor(), repeatId)
      await invites.reissueInvite(orgId, row.id, { mode: 'replace', expectedGeneration: 2, roleIds: [roleId] }, actor(), createInvitationOperationId())
      const second = await prisma.user.create({ data: { email: 'second-manager@example.test', emailCanonical: 'second-manager@example.test' } })
      const admin = await prisma.role.findFirstOrThrow({ where: { name: 'ADMIN', isSystem: true } })
      await seedOrgMember(prisma, { orgId, userId: second.id, roleId: admin.id })
      const principal = { ...actor().principal, sub: second.id }
      const secondActor = invitationActor({ user: principal, privilegedAdmission: { authenticated: principal, principal } })
      await expect(invites.reissueInvite(orgId, row.id, { mode: 'repeat', expectedGeneration: 3 }, secondActor, createInvitationOperationId())).rejects.toMatchObject({ errorCode: 'RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds: 3600 } })
      await expect(invites.createInvite(orgId, { email: recipient.email! }, actor(), id)).resolves.toEqual({ status: 'invited' })
      await expect(invites.reissueInvite(orgId, row.id, { mode: 'repeat', expectedGeneration: 1 }, actor(), repeatId)).resolves.toEqual({ status: 'invited' })
      expect((await prisma.orgInvite.findUniqueOrThrow({ where: { id: row.id } })).generation).toBe(3)
      const exhausted = await request(context.app.getHttpServer()).post(`/organizations/${orgId}/invites/${row.id}/reissue`)
        .auth(await invitationJwt(getFixture()), { type: 'bearer' }).set('X-Invitation-Operation-Id', createInvitationOperationId())
        .send({ mode: 'repeat', expectedGeneration: 3 }).expect(429)
      expect(exhausted.headers['retry-after']).toBe('3600')
      expect(exhausted.body.errorCode).toBe('RATE_LIMIT_EXCEEDED')
      expect(delivery).toHaveBeenCalledTimes(3)
      expect(await prisma.invitationOperation.count({ where: { organizationId: orgId } })).toBe(3)
      expect(await prisma.auditLog.count({ where: { organizationId: orgId, action: { in: ['org.invite_created', 'org.invite_reissued'] } } })).toBe(3)
    } finally { delivery.mockRestore() }
  })
  it('PD02 actual Redis concurrent pair edge admits exactly remaining allowance across actors', async () => {
    const { context, orgId } = getFixture()
    const limiter = context.app.get(InviteRateLimiterService)
    await limiter.consume(orgId, 'edge@example.test', 'actor-1')
    await limiter.consume(orgId, 'edge@example.test', 'actor-2')
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => limiter.consume(orgId, 'edge@example.test', `concurrent-${i}`)))
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(11)
  })
  it('PD02 actual Redis actor edge admits30 distinct recipients and rejects next', async () => {
    const { context, orgId } = getFixture()
    const limiter = context.app.get(InviteRateLimiterService)
    const outcomes = await Promise.allSettled(Array.from({ length: 32 }, (_, i) => limiter.consume(orgId, `actor-edge-${i}@example.test`, 'batch-actor')))
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(30)
    expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(2)
  })
}
