import type { RequestPrincipal } from '@amcore/shared'

import type { AuditLogService } from '../audit'

import { AuditActorType, AuditTargetType, type Prisma } from '@/generated/prisma/client'

export function recordMemberRoles(
  audit: AuditLogService,
  tx: Prisma.TransactionClient,
  orgId: string,
  memberId: string,
  userId: string,
  principal: RequestPrincipal,
  addedCount: number,
  removedCount: number,
  source: 'replace' | 'assign' | 'remove'
): ReturnType<AuditLogService['record']> {
  return audit.record(
    {
      action: 'org.member_roles_changed',
      actorType: AuditActorType.USER,
      actorId: principal.sub,
      targetType: AuditTargetType.USER,
      targetId: userId,
      organizationId: orgId,
      metadata: { actorCredentialType: principal.type, memberId, addedCount, removedCount, source },
    },
    { tx }
  )
}
