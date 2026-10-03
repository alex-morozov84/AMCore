import { readMemberRoles, replaceMemberRoles } from '@/entities/organization-context/index.server'
import { contextRoute } from '@/shared/api/bff/context-route'
import {
  memberMethodNotAllowed,
  memberRouteBody,
  memberRouteInput,
  memberRouteQuery,
} from '@/shared/api/bff/member-route'

export function GET(
  request: Request,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  return contextRoute(request, async () => {
    const { id, userId } = await context.params
    return readMemberRoles(id, userId, memberRouteQuery(request), memberRouteInput(request))
  })
}
export function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  return contextRoute(request, async () => {
    const { id, userId } = await context.params
    return replaceMemberRoles(id, userId, await memberRouteBody(request), memberRouteInput(request))
  })
}
export const HEAD = memberMethodNotAllowed
export const OPTIONS = memberMethodNotAllowed
export const POST = memberMethodNotAllowed
export const PUT = memberMethodNotAllowed
export const DELETE = memberMethodNotAllowed
