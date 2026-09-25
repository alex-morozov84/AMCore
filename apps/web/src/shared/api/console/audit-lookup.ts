import {
  adminAuditLookupInputSchema,
  type AdminAuditLookupResponse,
  adminAuditLookupResponseSchema,
  adminOrganizationListResponseSchema,
  adminUserListResponseSchema,
  auditDisplayIdSchema,
} from '@amcore/shared'
import { z } from 'zod'

import { apiErrorResponse, zodValidationErrors } from '@/shared/api/bff/api-error-response'
import { forwardRequestHeaders } from '@/shared/api/bff/proxy-headers'
import { resolveTrustedClientIp } from '@/shared/api/bff/trusted-client-ip'

import { isConsoleRequestOriginTrusted, resolveConsoleAccessToken } from './authenticated-proxy'

import 'server-only'

const API_URL = process.env.API_URL ?? 'http://localhost:5002'
function hasControl(value: string): boolean {
  for (const char of value) if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return true
  return false
}

function privateResponse(response: Response): Response {
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

function safeLabel(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !hasControl(value)
    ? value
    : undefined
}

/** Fixed, same-origin POST lookup: search text never enters the Audit page URL. */
export async function handleConsoleAuditLookup(request: Request): Promise<Response> {
  if (!isConsoleRequestOriginTrusted(request))
    return privateResponse(
      apiErrorResponse(request, {
        statusCode: 403,
        message: 'Request origin rejected',
      })
    )
  const parsed = adminAuditLookupInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return privateResponse(
      apiErrorResponse(request, {
        statusCode: 400,
        message: 'Validation failed',
        errors: zodValidationErrors(parsed.error),
      })
    )
  const resolved = await resolveConsoleAccessToken(request)
  if ('failure' in resolved) return privateResponse(resolved.failure)
  const { kind, search } = parsed.data
  const path = kind === 'user' ? '/api/v1/admin/users' : '/api/v1/admin/organizations'
  const query = new URLSearchParams({ page: '1', limit: '10', search })
  let upstream: Response
  try {
    upstream = await fetch(`${API_URL}${path}?${query}`, {
      method: 'GET',
      cache: 'no-store',
      headers: forwardRequestHeaders(
        request.headers,
        resolved.token,
        resolveTrustedClientIp(request.headers)
      ),
    })
  } catch {
    return privateResponse(
      apiErrorResponse(request, {
        statusCode: 503,
        message: 'Audit lookup temporarily unavailable',
      })
    )
  }
  if (!upstream.ok)
    return privateResponse(
      apiErrorResponse(request, {
        statusCode: [400, 401, 403, 429].includes(upstream.status) ? upstream.status : 503,
        message: 'Audit lookup unavailable',
      })
    )
  const body: unknown = await upstream.json().catch(() => null)
  const list =
    kind === 'user'
      ? adminUserListResponseSchema.safeParse(body)
      : adminOrganizationListResponseSchema.safeParse(body)
  if (!list.success)
    return privateResponse(
      apiErrorResponse(request, {
        statusCode: 503,
        message: 'Audit lookup temporarily unavailable',
      })
    )
  const items: AdminAuditLookupResponse['items'] = []
  for (const item of list.data.data as ReadonlyArray<{
    id: string
    name: string | null
    email?: string
    slug?: string
  }>) {
    if (!auditDisplayIdSchema.safeParse(item.id).success) continue
    if (kind === 'user' && item.email !== undefined)
      items.push({
        id: item.id,
        name: safeLabel(item.name, 120),
        email: z.email().safeParse(item.email).success ? item.email : undefined,
      })
    if (kind === 'organization' && item.slug !== undefined)
      items.push({ id: item.id, name: safeLabel(item.name, 120), slug: safeLabel(item.slug, 120) })
  }
  const result = adminAuditLookupResponseSchema.parse({
    kind,
    items,
    hasMore: list.data.total > 10,
  })
  return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
}
