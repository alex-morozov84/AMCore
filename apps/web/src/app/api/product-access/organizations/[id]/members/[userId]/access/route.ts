import { readMemberAccess } from '@/entities/organization-context/index.server'
import { contextRoute } from '@/shared/api/bff/context-route'
import { roleMethodDenied, roleRouteInput } from '@/shared/api/bff/role-route'

type Context = { params: Promise<{ id: string; userId: string }> }

export function GET(request: Request, context: Context) {
  return contextRoute(request, async () => {
    const { id, userId } = await context.params
    return readMemberAccess(id, userId, roleRouteInput(request))
  })
}
const denied = roleMethodDenied('GET')
export const HEAD = denied
export const OPTIONS = denied
export const POST = denied
export const PATCH = denied
export const PUT = denied
export const DELETE = denied
