import { readOrganizationMembers } from '@/entities/organization-context/index.server'
import { contextMethodNotAllowed, contextRoute } from '@/shared/api/bff/context-route'
import { memberRouteInput, memberRouteQuery } from '@/shared/api/bff/member-route'

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return contextRoute(request, async () =>
    readOrganizationMembers(
      (await context.params).id,
      memberRouteQuery(request),
      memberRouteInput(request)
    )
  )
}
export const HEAD = contextMethodNotAllowed
export const OPTIONS = contextMethodNotAllowed
export const POST = contextMethodNotAllowed
export const PUT = contextMethodNotAllowed
export const PATCH = contextMethodNotAllowed
export const DELETE = contextMethodNotAllowed
