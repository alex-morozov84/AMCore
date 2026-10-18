import {
  type AdministratorSummary,
  type AdministratorSummaryQuery,
  administratorSummarySchema,
  type ProvisioningProgress,
} from '@amcore/shared'

import type { Prisma } from '../../../generated/prisma/client.js'
import { canonicalAdmin } from '../canonical-admin.js'
import { invitationClock } from '../invitation-locks.js'
import { provisioningError as fail } from '../provisioning/provisioning-error.js'
import { readProvisioning } from '../provisioning/provisioning-read.js'

import { administratorProgress } from './administrator-read.js'

/** Fixed query count and one repeatable-read snapshot, independent of page size. */
export async function readAdministratorSummary(
  tx: Prisma.TransactionClient,
  orgId: string,
  input: AdministratorSummaryQuery,
  policy: ProvisioningProgress['policy']
): Promise<AdministratorSummary> {
  const adminId = await canonicalAdmin(tx)
  const org = await tx.organization.findUnique({ where: { id: orgId } })
  if (!org) throw fail('PROVISIONING_ORGANIZATION_UNAVAILABLE', 404)
  const now = await invitationClock(tx)
  const where = { organizationId: orgId, roles: { some: { roleId: adminId } } }
  const total = await tx.orgMember.count({ where })
  const admins = await tx.orgMember.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { id: 'asc' },
    take: input.limit,
    skip: (input.adminPage - 1) * input.limit,
  })
  const invitationTotal = await tx.organizationAdministratorInvitation.count({
    where: { organizationId: orgId, state: 'awaiting' },
  })
  const invitations = await tx.organizationAdministratorInvitation.findMany({
    where: { organizationId: orgId, state: 'awaiting' },
    include: { currentInvite: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: input.limit,
    skip: (input.invitationPage - 1) * input.limit,
  })
  const initial = await tx.organizationProvisioning.findFirst({
    where: { organizationId: orgId },
    select: { operationId: true },
  })
  return administratorSummarySchema.parse({
    organizationId: orgId,
    name: org.name,
    aclVersion: org.aclVersion,
    checkedAt: now.toISOString(),
    policy,
    administrators: {
      total,
      data: admins.map((m) => ({
        userId: m.user.id,
        memberId: m.id,
        name: m.user.name,
        email: m.user.email,
      })),
    },
    invitations: {
      total: invitationTotal,
      data: invitations.map((row) => administratorProgress(row, row.currentInvite, now)),
    },
    initial: initial ? await readProvisioning(tx, orgId, policy) : null,
  })
}
