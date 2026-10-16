import { createHash } from 'node:crypto'

import type { CreateOrganizationInput, OrganizationSetupIds } from '@amcore/shared'

import type { Organization, Prisma } from '../../generated/prisma/client.js'

import { templateSignature } from './system-template-validation.js'

export function establishmentFingerprint(input: unknown): string {
  return createHash('sha256')
    .update(templateSignature({ version: 1, input }))
    .digest('hex')
}

export async function writeEstablishedOrganization(
  tx: Prisma.TransactionClient,
  userId: string,
  adminRoleId: string,
  input: CreateOrganizationInput & { slug: string },
  actor: { id: string | null; source: 'self-service' | 'bootstrap-cli' | 'bootstrap-console' }
): Promise<{ organization: Organization; ids: OrganizationSetupIds }> {
  const organization = await tx.organization.create({ data: input })
  const member = await tx.orgMember.create({ data: { userId, organizationId: organization.id } })
  const grant = await tx.memberRole.create({ data: { memberId: member.id, roleId: adminRoleId } })
  const ids = {
    organizationId: organization.id,
    userId,
    memberId: member.id,
    adminRoleId,
    adminGrantId: grant.id,
  }
  await tx.auditLog.create({
    data: {
      action: 'org.created',
      actorType: actor.id === null ? 'SYSTEM' : 'USER',
      actorId: actor.id,
      targetType: 'ORGANIZATION',
      targetId: organization.id,
      organizationId: organization.id,
      metadata: {
        source: actor.source,
        userId,
        memberId: member.id,
        adminRoleId,
        adminGrantId: grant.id,
      },
    },
  })
  return { organization, ids }
}
