import {
  createRoleDefinition,
  listRoleDefinitions,
} from '@/entities/organization-context/index.server'
import { contextRoute } from '@/shared/api/bff/context-route'
import {
  roleMethodDenied,
  roleRouteBody,
  roleRouteInput,
  roleRouteQuery,
} from '@/shared/api/bff/role-route'

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return contextRoute(request, async () =>
    listRoleDefinitions((await context.params).id, roleRouteQuery(request), roleRouteInput(request))
  )
}
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return contextRoute(
    request,
    async () =>
      createRoleDefinition(
        (await context.params).id,
        await roleRouteBody(request),
        roleRouteInput(request)
      ),
    201
  )
}
const denied = roleMethodDenied('GET, POST')
export const HEAD = denied
export const OPTIONS = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
