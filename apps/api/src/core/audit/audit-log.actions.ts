export const AUDIT_ACTIONS = [
  'admin.cleanup.executed',
  'admin.user.sessions_revoked',
  'admin.user.system_role_changed',
  'api_key.created',
  'api_key.revoked',
  'auth.step_up_failed',
  'auth.step_up_succeeded',
  'org.invite_accepted',
  'org.invite_created',
  'org.invite_revoked',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]
