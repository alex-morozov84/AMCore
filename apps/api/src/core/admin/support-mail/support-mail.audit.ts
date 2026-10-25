import type { SupportMailKind } from '@amcore/shared'

import { AuditActorType, AuditTargetType, type Prisma } from '../../../generated/prisma/client.js'
import type { AuditLogService } from '../../audit/audit-log.service.js'

export async function recordSupportMail(
  audit: AuditLogService,
  tx: Prisma.TransactionClient,
  event: 'requested' | 'dispatching' | 'settled' | 'refused',
  attempt: {
    id: string
    actorUserId: string
    targetUserId: string
    kind: string
    provider: string
    tokenIssuedAt: Date | null
  },
  outcome?: string,
  reason?: string | null
): Promise<void> {
  await audit.record(
    {
      action: `admin.user.support_mail_${event}`,
      actorType: AuditActorType.USER,
      actorId: attempt.actorUserId,
      targetId: attempt.targetUserId,
      targetType: AuditTargetType.USER,
      metadata: {
        attemptId: attempt.id,
        kind: attempt.kind as SupportMailKind,
        provider: attempt.provider,
        tokenIssued: attempt.tokenIssuedAt !== null,
        outcome,
        reason: reason ?? undefined,
      },
    },
    { tx }
  )
}
