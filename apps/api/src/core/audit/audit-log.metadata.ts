import type { Prisma } from '@prisma/client'

import type { AuditAction } from './audit-log.actions'

interface MetadataSpec {
  [key: string]: MetadataRule
}

type MetadataRule = MetadataSpec | PrimitiveArrayRule | true
type Primitive = boolean | number | string | null
type PrimitiveArrayRule = 'number[]' | 'string[]'

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

const specs: Record<AuditAction, MetadataSpec> = {
  'admin.cleanup.executed': { counts: cleanupCounts },
  'admin.user.sessions_revoked': { count: true, reason: true },
  'admin.user.system_role_changed': { afterSystemRole: true, beforeSystemRole: true },
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
