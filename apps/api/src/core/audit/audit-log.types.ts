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
  /**
   * Only meaningful on the **non-transactional** path. Default `true` (best-effort): a failed audit
   * write is logged and swallowed so it never breaks a post-commit side-effect that already
   * happened. `false` (strict): the audit-write failure **propagates**, so a caller that requires
   * durable accountability *before* it acts — a privileged cross-user read audited before content is
   * served (ADR-045 "monitor access to logs", fail-closed) — aborts instead of leaking. In-tx writes
   * are always strict (a throw rolls the transaction back) regardless of this flag.
   */
  failOpen?: boolean
}
