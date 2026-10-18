import type { OrganizationAdministratorInvitation, OrganizationProvisioning, Prisma } from '../../generated/prisma/client.js'
import type { AuditLogService } from '../audit/index.js'
import { canonicalAdmin } from '../organizations/canonical-admin.js'
import { provisioningError } from '../organizations/provisioning/provisioning-error.js'

import { managedInvitationOwner } from './managed-invitation.js'
import { clearedProvisioningMail, completeProvisioning } from './provisioning-settlement.js'

export type AdministratorSettlement =
  | { kind: 'initial'; row: OrganizationProvisioning }
  | { kind: 'additional'; row: OrganizationAdministratorInvitation }

/** The recipient path already holds user, parent, ordered roles and invite locks. */
export async function checkAdministratorRecipient(
  tx: Prisma.TransactionClient,
  orgId: string,
  inviteId: string,
  generation: number,
  userId: string,
  roleIds: string[]
): Promise<AdministratorSettlement | undefined> {
  const owner = await managedInvitationOwner(tx, orgId, inviteId)
  if (!owner) return undefined
  const adminId = await canonicalAdmin(tx)
  if (owner.currentGeneration !== generation || roleIds.length !== 1 || roleIds[0] !== adminId)
    throw provisioningError('PROVISIONING_STATE_CHANGED')
  const member = await tx.orgMember.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } }, include: { roles: true },
  })
  if (member && !member.roles.some(r => r.roleId === adminId))
    throw provisioningError(owner.kind === 'initial' ? 'PROVISIONING_ADMIN_CONFLICT' : 'ADMIN_MEMBER_ASSIGNMENT_REQUIRED')
  if (owner.kind === 'initial') {
    const [row] = await tx.$queryRaw<OrganizationProvisioning[]>`
      SELECT * FROM core.organization_provisionings WHERE "operationId"=${owner.id}::uuid FOR UPDATE`
    return { kind: 'initial', row: row! }
  }
  const [row] = await tx.$queryRaw<OrganizationAdministratorInvitation[]>`
    SELECT * FROM core.organization_administrator_invitations WHERE id=${owner.id}::uuid FOR UPDATE`
  return { kind: 'additional', row: row! }
}

export async function completeAdministratorInvitation(
  tx: Prisma.TransactionClient,
  audit: AuditLogService,
  managed: AdministratorSettlement,
  userId: string,
  memberId: string,
  adminRoleId: string,
  now: Date
): Promise<void> {
  if (managed.kind === 'initial')
    return completeProvisioning(tx, managed.row, userId, memberId, adminRoleId, now)
  const grant = await tx.memberRole.findUniqueOrThrow({ where: { memberId_roleId: { memberId, roleId: adminRoleId } } })
  await tx.organizationAdministratorInvitation.update({ where: { id: managed.row.id }, data: {
    state: 'completed', completedAt: now, revision: { increment: 1 }, currentInviteId: null,
    currentGeneration: null, inviteLocale: null, ...clearedProvisioningMail,
  } })
  await audit.record({ action: 'org.administrator_invitation_completed', actorId: userId, actorType: 'USER',
    organizationId: managed.row.organizationId, targetType: 'ORGANIZATION', targetId: managed.row.organizationId,
    metadata: { administratorInvitationId: managed.row.id, memberId, adminGrantId: grant.id },
  }, { tx })
}
