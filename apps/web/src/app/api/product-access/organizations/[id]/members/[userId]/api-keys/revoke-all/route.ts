import { MEMBER_KEY_REQUEST_BYTES } from '@amcore/shared'

import { revokeMemberKeys } from '@/entities/organization-context/index.server'
import { contextRoute } from '@/shared/api/bff/context-route'
import { contextRouteBody, contextRouteInput } from '@/shared/api/bff/context-route-input'
export function POST(
  request: Request,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  return contextRoute(request, async () => {
    const { id, userId } = await context.params
    return revokeMemberKeys(
      id,
      userId,
      await contextRouteBody(request, MEMBER_KEY_REQUEST_BYTES, true),
      contextRouteInput(request)
    )
  })
}
const denied = () => new Response(null, { status: 405, headers: { Allow: 'POST' } })
export const GET = denied
export const PATCH = denied
export const DELETE = denied
export const PUT = denied
export const HEAD = denied
export const OPTIONS = denied
