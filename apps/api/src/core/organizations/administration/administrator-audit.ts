import type { Prisma } from '../../../generated/prisma/client.js'
import type { AuditLogService } from '../../audit/index.js'

export type AdministratorAuditAction =
  | 'org.administrator_invitation_created'
  | 'org.administrator_invitation_reissued'
  | 'org.administrator_invitation_replaced'
  | 'org.administrator_invitation_cancelled'
  | 'org.administrator_assigned'

export function administratorAudit(
  audit: AuditLogService,
  tx: Prisma.TransactionClient,
  action: AdministratorAuditAction,
  orgId: string,
  actorId: string,
  reason: string,
  metadata: Prisma.InputJsonObject
): Promise<void> {
  return audit.record(
    {
      action,
      actorId,
      actorType: 'USER',
      organizationId: orgId,
      targetType: 'ORGANIZATION',
      targetId: orgId,
      metadata: { ...metadata, reason },
    },
    { tx }
  )
}
