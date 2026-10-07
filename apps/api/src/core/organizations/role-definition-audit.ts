import type { AuditAction, RequestPrincipal } from '@amcore/shared'

import type { AuditLogService } from '../audit'

import { AuditActorType, AuditTargetType, type Prisma } from '@/generated/prisma/client'

export interface RoleAuditFacts {
  roleId: string
  revisionBefore: number
  revisionAfter: number
  addedPresetCount: number
  removedPresetCount: number
  fullControl: 'added' | 'removed' | 'none'
  /** Present only where the command measured them (editor commands, deletion). */
  holderCount?: number
  liveInvitationCount?: number
  nameChanged: boolean
  descriptionChanged: boolean
  /** `editor` = the complete-definition commands; `legacy` = the per-rule/metadata routes. */
  source: 'editor' | 'legacy'
}

/**
 * Strict in-transaction audit for a role-definition change: a failed audit write rolls the whole
 * command back. Metadata is ids and counts only (see the bounded allowlist in the audit module).
 */
export function recordRoleDefinition(
  audit: AuditLogService,
  tx: Prisma.TransactionClient,
  action: Extract<AuditAction, 'org.role_created' | 'org.role_updated' | 'org.role_deleted'>,
  orgId: string,
  principal: RequestPrincipal,
  facts: RoleAuditFacts
): Promise<void> {
  return audit.record(
    {
      action,
      actorType: AuditActorType.USER,
      actorId: principal.sub,
      targetType: AuditTargetType.ORGANIZATION,
      targetId: orgId,
      organizationId: orgId,
      metadata: { actorCredentialType: principal.type, ...facts },
    },
    { tx }
  )
}

export function fullControlTransition(
  before: boolean,
  after: boolean
): RoleAuditFacts['fullControl'] {
  if (before === after) return 'none'
  return after ? 'added' : 'removed'
}
