import type { OrganizationProvisioning, Prisma } from '../../generated/prisma/client.js'

/** Caller holds org, ordered roles and invite; progress is always locked last. */
export async function lockMarkedProvisioning(
  tx: Prisma.TransactionClient,
  inviteId: string
): Promise<OrganizationProvisioning | undefined> {
  const [row] = await tx.$queryRaw<OrganizationProvisioning[]>`
    SELECT * FROM core.organization_provisionings WHERE "currentInviteId" = ${inviteId} FOR UPDATE`
  return row
}
export async function completeProvisioning(
  tx: Prisma.TransactionClient,
  row: OrganizationProvisioning,
  userId: string,
  memberId: string,
  adminRoleId: string,
  now: Date
): Promise<void> {
  const grant = await tx.memberRole.findUniqueOrThrow({
    where: { memberId_roleId: { memberId, roleId: adminRoleId } },
  })
  await tx.organizationProvisioning.update({
    where: { operationId: row.operationId },
    data: {
      state: 'completed',
      completedAt: now,
      revision: { increment: 1 },
      currentInviteId: null,
      currentGeneration: null,
      inviteLocale: null,
      originalAdminUserId: userId,
      originalMemberId: memberId,
      originalAdminRoleId: adminRoleId,
      originalAdminGrantId: grant.id,
      ...clearedProvisioningMail,
    },
  })
  await tx.auditLog.create({
    data: {
      action: 'org.provisioning_completed',
      actorId: userId,
      actorType: 'USER',
      organizationId: row.organizationId,
      targetType: 'ORGANIZATION',
      targetId: row.organizationId,
      metadata: { memberId, adminRoleId, adminGrantId: grant.id, operationId: row.operationId },
    },
  })
}
export const clearedProvisioningMail = {
  attemptId: null,
  attemptInviteId: null,
  attemptGeneration: null,
  attemptAt: null,
  mailOutcome: null,
  mailObservedAt: null,
} as const

export { rejectManagedInvitation } from './managed-invitation.js'
