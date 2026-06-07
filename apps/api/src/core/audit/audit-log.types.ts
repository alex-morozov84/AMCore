import type { AuditActorType, AuditCategory, AuditTargetType, Prisma } from '@prisma/client'

import type { AuditAction } from './audit-log.actions'

export interface AuditLogEntry {
  action: AuditAction
  actorType: AuditActorType
  actorId?: string | null
  category?: AuditCategory
  ip?: string | null
  metadata?: Record<string, unknown>
  organizationId?: string | null
  requestId?: string | null
  targetId?: string | null
  targetType?: AuditTargetType | null
}

export interface AuditLogRecordOptions {
  tx?: Prisma.TransactionClient
}
