/** Current semantic actions offered by the Console selector. Historical codes remain queryable. */
export const AUDIT_ACTIONS = [
  'admin.audit_logs.viewed',
  'admin.api_keys.viewed',
  'admin.api_keys.revocation_requested',
  'admin.cleanup.executed',
  'admin.runtime_setting.changed',
  'admin.user.session_revoked',
  'admin.user.sessions_revoked',
  'admin.user.sessions_viewed',
  'admin.user.system_role_changed',
  'ai.approval.approved',
  'ai.approval.expired',
  'ai.approval.rejected',
  'ai.approval.requested',
  'ai.assistant.created',
  'ai.assistant.disabled',
  'ai.assistant.enabled',
  'ai.assistant.updated',
  'ai.assistant.version_published',
  'ai.conversation.artifact_accessed',
  'ai.conversation.operator_message',
  'ai.conversation.released',
  'ai.conversation.taken_over',
  'ai.conversation.transcript_accessed',
  'ai.tool.execution_failed',
  'ai.tool.invoked',
  'api_key.created',
  'api_key.revoked',
  'auth.step_up_failed',
  'auth.step_up_succeeded',
  'org.invite_accepted',
  'org.invite_created',
  'org.invite_revoked',
  'org.invite_reissued',
  'org.member_roles_changed',
  'telegram.connection_linked',
  'telegram.connection_unlinked',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/**
 * Read-only "viewing sensitive data" actions, hidden from Audit browsing
 * by default (ADR-083's precedent): a successful privileged read is
 * itself audited so the read is not invisible, but surfacing every routine
 * read alongside actual mutations would drown out the events an operator
 * usually wants. `includeReadEvents=true` (or an explicit `action`/`actions`
 * filter naming one of these codes) opts back in.
 */
export const HIDDEN_READ_AUDIT_ACTIONS: readonly AuditAction[] = [
  'admin.audit_logs.viewed',
  'admin.api_keys.viewed',
  'admin.user.sessions_viewed',
]
