import { readCapabilityCatalogue } from '@/entities/organization-context/index.server'
import { contextRoute } from '@/shared/api/bff/context-route'
import { roleMethodDenied, roleRouteInput } from '@/shared/api/bff/role-route'

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return contextRoute(request, async () =>
    readCapabilityCatalogue((await context.params).id, roleRouteInput(request))
  )
}
const denied = roleMethodDenied('GET')
export const HEAD = denied
export const OPTIONS = denied
export const POST = denied
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
