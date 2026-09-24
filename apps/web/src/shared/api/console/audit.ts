import {
  type AdminAuditQuery,
  type AdminAuditResponse,
  adminAuditResponseSchema,
} from '@amcore/shared'

import { type DataOutcome } from '@/shared/api/server'
import { resolveAuthHeader } from '@/shared/api/server/auth-header'
import { classifyStatus, classifyThrown } from '@/shared/api/server/classify'
import { BackendRequestError } from '@/shared/api/server/errors'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'

/** Domain-owned query grammar; it never accepts an arbitrary backend path. */
export function auditQueryString(query: Partial<AdminAuditQuery>): string {
  const params = new URLSearchParams()
  for (const key of [
    'actorId',
    'actorType',
    'action',
    'targetId',
    'targetType',
    'organizationId',
    'from',
    'to',
    'limit',
    'cursor',
  ] as const) {
    const value = query[key]
    if (value !== undefined) params.set(key, String(value))
  }
  return params.toString()
}

/** Each call is a new authorized, audited API read; no persistent cache. */
export async function fetchConsoleAudit(
  query: Partial<AdminAuditQuery>
): Promise<DataOutcome<AdminAuditResponse>> {
  const correlationId = crypto.randomUUID()
  const auth = await resolveAuthHeader('required', getConsoleAwareAccessToken)
  if ('unavailable' in auth) return { status: 'unavailable', reason: 'upstream', correlationId }
  let response: Response
  try {
    response = await fetch(`${API_URL}/api/v1/admin/audit-logs?${auditQueryString(query)}`, {
      headers: { Authorization: auth.header!, 'X-Correlation-Id': correlationId },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) {
    const reason = classifyThrown(error)
    if (!reason) throw error
    return { status: 'unavailable', reason, correlationId }
  }
  if (!response.ok) {
    const kind = classifyStatus(response.status)
    if (kind === 'rejected')
      throw new BackendRequestError('rejected', correlationId, response.status)
    if (kind === 'not-found') return { status: 'not-found' }
    return { status: 'unavailable', reason: kind, correlationId }
  }
  const parsed = adminAuditResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success)
    throw new BackendRequestError('invalid-payload', correlationId, response.status)
  return { status: 'success', data: parsed.data }
}
