import type { Prisma } from '@prisma/client'

import type { AuditAction } from './audit-log.actions'

interface MetadataSpec {
  [key: string]: MetadataRule
}

type MetadataRule = MetadataSpec | PrimitiveArrayRule | MetadataValueRule | true
type Primitive = boolean | number | string | null
type PrimitiveArrayRule = 'number[]' | 'string[]'
/** A custom bounded-value rule: returns the accepted primitive, or `undefined` to drop the field. */
type MetadataValueRule = (value: unknown) => Primitive | undefined

/** Accept a string only when it is within `maxLength` and matches `pattern`; else drop the field. */
function boundedString(maxLength: number, pattern: RegExp): MetadataValueRule {
  return (value) =>
    typeof value === 'string' && value.length <= maxLength && pattern.test(value)
      ? value
      : undefined
}

/** A bounded lowercase snake code — toolId, riskClass, outcome, decision, reasonCode (Arc E). */
const aiCode = boundedString(64, /^[a-z][a-z0-9_]*$/)
/** A bounded cuid-shaped id — runId, invocationId, approvalId (Arc E). */
const aiId = boundedString(64, /^[a-z0-9]+$/)
/** A bounded assistant slug — lowercase alnum + hyphen (Arc F). */
const aiSlug = boundedString(64, /^[a-z0-9][a-z0-9-]*$/)
/**
 * An operator-supplied takeover reason / ticket ref (Arc F, D1 constraint). NOT transcript content — a
 * bounded justification the owner requires for privileged-access accountability. Accepted only when it
 * is a non-empty string ≤ 200 chars with no control characters (any language); otherwise dropped.
 */
const aiReasonRef: MetadataValueRule = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return undefined
  // No control characters (any language is otherwise allowed - this is a bounded ref, not content).
  for (let i = 0; i < value.length; i += 1) if (value.charCodeAt(i) < 0x20) return undefined
  return value
}

const cleanupCounts: MetadataSpec = {
  expiredApiKeys: true,
  expiredEmailVerificationTokens: true,
  expiredPasswordResetTokens: true,
  expiredPendingInvites: true,
  expiredSessions: true,
  failures: 'string[]',
  staleTerminalInvites: true,
}

const commonSpec: MetadataSpec = { emailHash: true, pinoEvent: true }

/**
 * AI tool-loop + approval audit metadata (Track C — ADR-054, Arc E). Every allowed key is a bounded,
 * content-free identifier or code — never tool args, tool result, prompt, provider body, or user
 * text. `toolId`/`riskClass`/`invocationId`/`runId` describe *what* acted; `approvalId`/`decision`/
 * `reasonCode`/`outcome` describe the gate/result.
 */
const aiToolContext: MetadataSpec = {
  toolId: aiCode,
  riskClass: aiCode,
  invocationId: aiId,
  runId: aiId,
}
const aiApprovalContext: MetadataSpec = { ...aiToolContext, approvalId: aiId }

/**
 * AI assistant-admin audit metadata (Track C — ADR-054, Arc F.1). Bounded and content-free — the
 * assistant `systemPrompt`/model/tool config is NEVER audited; only which version of which slug
 * changed and its enabled state.
 */
const aiAssistantContext: MetadataSpec = { slug: aiSlug, version: true, enabled: true }

/**
 * AI conversation takeover/release audit metadata (Track C — ADR-054, Arc F). Content-free: the
 * generation transition, the resulting control, the actor's role, how many bot runs were superseded,
 * and the operator's bounded reason/ticket ref (never transcript/prompt content).
 */
const aiConversationControlContext: MetadataSpec = {
  conversationId: aiId,
  fromGeneration: true,
  toGeneration: true,
  control: aiCode,
  actorRole: aiCode,
  supersededRuns: true,
  voidedApprovals: true,
  reasonRef: aiReasonRef,
}

const specs: Record<AuditAction, MetadataSpec> = {
  'admin.cleanup.executed': { counts: cleanupCounts },
  'admin.user.sessions_revoked': { count: true, reason: true },
  'admin.user.system_role_changed': { afterSystemRole: true, beforeSystemRole: true },
  'ai.approval.approved': { ...aiApprovalContext, decision: aiCode },
  'ai.approval.expired': { ...aiApprovalContext, reasonCode: aiCode },
  'ai.approval.rejected': { ...aiApprovalContext, decision: aiCode, reasonCode: aiCode },
  'ai.approval.requested': { ...aiApprovalContext },
  'ai.assistant.created': { ...aiAssistantContext },
  'ai.assistant.disabled': { ...aiAssistantContext },
  'ai.assistant.enabled': { ...aiAssistantContext },
  'ai.assistant.updated': { ...aiAssistantContext },
  'ai.assistant.version_published': { ...aiAssistantContext },
  'ai.conversation.released': { ...aiConversationControlContext },
  'ai.conversation.taken_over': { ...aiConversationControlContext },
  'ai.tool.execution_failed': { ...aiToolContext, reasonCode: aiCode },
  'ai.tool.invoked': { ...aiToolContext, outcome: aiCode },
  'api_key.created': { expiresAt: true, name: true, scopes: 'string[]' },
  'api_key.revoked': { reason: true },
  'auth.step_up_failed': { reason: true },
  'auth.step_up_succeeded': { sessionId: true },
  'org.invite_accepted': { actorCredentialType: true, roleId: true },
  'org.invite_created': { actorCredentialType: true, branch: true, roleId: true },
  'org.invite_revoked': { actorCredentialType: true },
  // No metadata — the security event is bounded to actor + target; no chat/user id or token.
  'telegram.connection_linked': {},
  'telegram.connection_unlinked': {},
}

export function sanitizeAuditMetadata(
  action: AuditAction,
  input?: Record<string, unknown>
): Prisma.JsonObject {
  return sanitizeObject(input, { ...commonSpec, ...specs[action] })
}

function sanitizeObject(input: unknown, spec: MetadataSpec): Prisma.JsonObject {
  if (!isRecord(input)) return {}
  const output: Prisma.JsonObject = {}
  for (const [key, rule] of Object.entries(spec)) {
    const value = sanitizeValue(input[key], rule)
    if (value !== undefined) output[key] = value
  }
  return output
}

function sanitizeValue(value: unknown, rule: MetadataRule): Prisma.JsonValue | undefined {
  if (rule === true) return sanitizePrimitive(value)
  if (typeof rule === 'function') return rule(value)
  if (typeof rule === 'string') return sanitizePrimitiveArray(value, rule)
  return sanitizeNested(value, rule)
}

function sanitizePrimitive(value: unknown): Primitive | undefined {
  return isPrimitive(value) ? value : undefined
}

function sanitizePrimitiveArray(
  value: unknown,
  rule: PrimitiveArrayRule
): Prisma.JsonArray | undefined {
  if (!Array.isArray(value)) return undefined
  const expected = rule === 'number[]' ? 'number' : 'string'
  const items = value.filter((item) => typeof item === expected)
  return items.length > 0 ? (items as Prisma.JsonArray) : undefined
}

function sanitizeNested(value: unknown, spec: MetadataSpec): Prisma.JsonObject | undefined {
  const nested = sanitizeObject(value, spec)
  return Object.keys(nested).length > 0 ? nested : undefined
}

function isPrimitive(value: unknown): value is Primitive {
  return value === null || ['boolean', 'number', 'string'].includes(typeof value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
