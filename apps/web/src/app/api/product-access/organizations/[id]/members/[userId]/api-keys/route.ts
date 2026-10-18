import { MEMBER_KEY_QUERY_BYTES } from '@amcore/shared'

import { readMemberKeys } from '@/entities/organization-context/index.server'
import { contextRoute } from '@/shared/api/bff/context-route'
import { contextRouteInput, contextRouteQuery } from '@/shared/api/bff/context-route-input'
export function GET(
  request: Request,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  return contextRoute(request, async () => {
    const { id, userId } = await context.params
    return readMemberKeys(
      id,
      userId,
      contextRouteQuery(request, MEMBER_KEY_QUERY_BYTES),
      contextRouteInput(request)
    )
  })
}
const denied = () => new Response(null, { status: 405, headers: { Allow: 'GET' } })
export const POST = denied
export const PATCH = denied
export const DELETE = denied
export const PUT = denied
export const HEAD = denied
export const OPTIONS = denied
