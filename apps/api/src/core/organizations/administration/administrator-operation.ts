import type { InvitationOperation, Prisma } from '../../../generated/prisma/client.js'
import { acquireXactLock } from '../../../prisma/advisory-lock.js'
import { lockInvitationOperation } from '../invitation-operation.js'
import { provisioningError } from '../provisioning/provisioning-error.js'

/** One lock order for create, recovery, assignment and lookup; no extra receipt table. */
export async function lockAdministratorOperation(
  tx: Prisma.TransactionClient,
  actorId: string,
  orgId: string,
  operationId: string
): Promise<InvitationOperation | null> {
  await acquireXactLock(tx, `administrator-invitation:${operationId}`)
  return lockInvitationOperation(tx, actorId, `administrator:${orgId}`, operationId)
}
export async function rejectAdministratorCreationIdentity(
  tx: Prisma.TransactionClient,
  operationId: string
): Promise<void> {
  if (
    await tx.organizationAdministratorInvitation.findUnique({
      where: { id: operationId },
      select: { id: true },
    })
  )
    throw provisioningError('ADMIN_INTENT_MISMATCH')
}
