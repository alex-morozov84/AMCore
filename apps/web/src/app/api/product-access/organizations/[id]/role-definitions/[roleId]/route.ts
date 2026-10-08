import {
  readRoleDefinition,
  saveRoleDefinition,
} from '@/entities/organization-context/index.server'
import { contextRoute } from '@/shared/api/bff/context-route'
import { roleMethodDenied, roleRouteBody, roleRouteInput } from '@/shared/api/bff/role-route'

type Context = { params: Promise<{ id: string; roleId: string }> }

export function GET(request: Request, context: Context) {
  return contextRoute(request, async () => {
    const { id, roleId } = await context.params
    return readRoleDefinition(id, roleId, roleRouteInput(request))
  })
}
export function PATCH(request: Request, context: Context) {
  return contextRoute(request, async () => {
    const { id, roleId } = await context.params
    return saveRoleDefinition(id, roleId, await roleRouteBody(request), roleRouteInput(request))
  })
}
const denied = roleMethodDenied('GET, PATCH')
export const HEAD = denied
export const OPTIONS = denied
export const POST = denied
export const PUT = denied
export const DELETE = denied
