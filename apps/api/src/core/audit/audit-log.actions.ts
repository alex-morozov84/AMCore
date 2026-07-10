export const AUDIT_ACTIONS = [
  'admin.cleanup.executed',
  'admin.user.sessions_revoked',
  'admin.user.system_role_changed',
  'ai.approval.approved',
  'ai.approval.expired',
  'ai.approval.rejected',
  'ai.approval.requested',
  'ai.tool.execution_failed',
  'ai.tool.invoked',
  'api_key.created',
  'api_key.revoked',
  'auth.step_up_failed',
  'auth.step_up_succeeded',
  'org.invite_accepted',
  'org.invite_created',
  'org.invite_revoked',
  'telegram.connection_linked',
  'telegram.connection_unlinked',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]
