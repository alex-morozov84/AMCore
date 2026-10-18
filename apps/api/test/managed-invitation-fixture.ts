import { createInvitationOperationId } from '@amcore/shared'

import type { OrgInvite } from '../src/generated/prisma/client'

import type { E2ETestContext } from './helpers'
import type { prepareProvisioningFixture } from './provisioning-fixture'

export async function prepareManagedInvitation(
  context: E2ETestContext,
  fixture: Awaited<ReturnType<typeof prepareProvisioningFixture>>,
  kind: 'initial' | 'additional'
): Promise<{ orgId: string; token: string; current: OrgInvite; roleId: string }> {
  const created = await fixture.create().expect(201)
  const orgId: string = created.body.organizationId
  if (kind === 'additional') {
    await fixture
      .recover(orgId, 'cancel', { operationId: createInvitationOperationId(), expectedRevision: 1 })
      .expect(200)
    await fixture
      .http()
      .post(`/admin/organizations/${orgId}/administrator-invitations`)
      .auth(fixture.token, { type: 'bearer' })
      .send({
        operationId: createInvitationOperationId(),
        email: 'admin@e2e.amcore.test',
        reason: 'Controlled guard fixture',
      })
      .expect(201)
  }
  const registered = await fixture
    .http()
    .post('/auth/register')
    .send({ email: 'manager@e2e.amcore.test', password: 'StrongP@ss123' })
    .expect(201)
  const admin = await context.prisma.role.findFirstOrThrow({
    where: { name: 'ADMIN', organizationId: null },
  })
  const member = await context.prisma.role.findFirstOrThrow({
    where: { name: 'MEMBER', organizationId: null },
  })
  await context.prisma.orgMember.create({
    data: {
      userId: registered.body.user.id,
      organizationId: orgId,
      roles: { create: { roleId: admin.id } },
    },
  })
  const switched = await fixture
    .http()
    .post(`/organizations/${orgId}/switch`)
    .auth(registered.body.accessToken, { type: 'bearer' })
    .expect(200)
  const token: string = switched.body.accessToken
  const current = await context.prisma.orgInvite.findFirstOrThrow({
    where: { organizationId: orgId, revokedAt: null, acceptedAt: null },
  })
  return { orgId, token, current, roleId: member.id }
}
