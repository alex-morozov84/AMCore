import { z } from 'zod'

import {
  type AdminAuditResponse,
  auditActionCodeSchema,
  auditDisplayIdSchema,
} from '@amcore/shared'

type Item = AdminAuditResponse['items'][number]
type User = { id: string; name: string | null; email: string }
type Organization = { id: string; name: string; slug: string }
export interface AuditProjectionRow {
  id: string
  createdAt: Date
  actorType: Item['actorType']
  actorId: string | null
  action: string
  targetType: Item['targetType']
  targetId: string | null
  organizationId: string | null
  category: Item['category']
  metadata: unknown
}

const CODE = /^[a-z][a-z0-9_]*$/

function hasControl(value: string): boolean {
  for (const char of value) if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return true
  return false
}

export function safeAuditId(value: string | null): string | null {
  return value && auditDisplayIdSchema.safeParse(value).success ? value : null
}

function safeText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !hasControl(value)
    ? value
    : undefined
}

function safeCode(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 64 && CODE.test(value) ? value : undefined
}

export function auditSummary(action: string, metadata: unknown): Item['summary'] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const m = metadata as Record<string, unknown>
  if (action === 'admin.user.system_role_changed') {
    const role = (v: unknown): 'USER' | 'SUPER_ADMIN' | undefined =>
      v === 'USER' || v === 'SUPER_ADMIN' ? v : undefined
    return { beforeSystemRole: role(m.beforeSystemRole), afterSystemRole: role(m.afterSystemRole) }
  }
  if (action === 'admin.user.sessions_revoked') {
    return {
      count:
        Number.isInteger(m.count) &&
        typeof m.count === 'number' &&
        m.count >= 0 &&
        m.count <= 1_000_000
          ? m.count
          : undefined,
    }
  }
  if (
    action.startsWith('ai.approval.') &&
    ['ai.approval.approved', 'ai.approval.rejected', 'ai.approval.expired'].includes(action)
  ) {
    return { decision: safeCode(m.decision), reasonCode: safeCode(m.reasonCode) }
  }
  if (action === 'ai.tool.invoked') return { outcome: safeCode(m.outcome) }
  return {}
}

function userIdentity(id: string | null, users: Map<string, User>): Item['actorIdentity'] {
  if (!id) return undefined
  const user = users.get(id)
  if (!user) return { status: 'not_found' }
  const email = safeText(user.email, 255)
  return {
    status: 'current',
    name: safeText(user.name, 120),
    email: email && z.email().safeParse(email).success ? email : undefined,
  }
}

function organizationIdentity(
  id: string | null,
  organizations: Map<string, Organization>
): Item['organizationIdentity'] {
  if (!id) return undefined
  const organization = organizations.get(id)
  if (!organization) return { status: 'not_found' }
  return {
    status: 'current',
    name: safeText(organization.name, 120),
    slug: safeText(organization.slug, 120),
  }
}

export function projectAuditRow(
  row: AuditProjectionRow,
  users: Map<string, User>,
  organizations: Map<string, Organization>
): Item {
  const actorId = safeAuditId(row.actorId)
  const targetId = safeAuditId(row.targetId)
  const organizationId = safeAuditId(row.organizationId)
  return {
    id: safeAuditId(row.id),
    createdAt: row.createdAt.toISOString(),
    actorType: row.actorType,
    actorId,
    actorIdentity: row.actorType === 'USER' ? userIdentity(actorId, users) : undefined,
    action: auditActionCodeSchema.safeParse(row.action).success ? row.action : null,
    targetType: row.targetType,
    targetId,
    targetIdentity: row.targetType === 'USER' ? userIdentity(targetId, users) : undefined,
    targetOrganizationIdentity:
      row.targetType === 'ORGANIZATION' ? organizationIdentity(targetId, organizations) : undefined,
    organizationId,
    organizationIdentity: organizationIdentity(organizationId, organizations),
    category: row.category,
    summary: auditSummary(row.action, row.metadata),
  }
}
