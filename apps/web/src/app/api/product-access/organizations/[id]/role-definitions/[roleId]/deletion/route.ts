import { deleteRoleDefinition } from '@/entities/organization-context/index.server'
import { contextRoute } from '@/shared/api/bff/context-route'
import { roleMethodDenied, roleRouteBody, roleRouteInput } from '@/shared/api/bff/role-route'

export function POST(
  request: Request,
  context: { params: Promise<{ id: string; roleId: string }> }
) {
  return contextRoute(request, async () => {
    const { id, roleId } = await context.params
    return deleteRoleDefinition(id, roleId, await roleRouteBody(request), roleRouteInput(request))
  })
}
const denied = roleMethodDenied('POST')
export const GET = denied
export const HEAD = denied
export const OPTIONS = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
