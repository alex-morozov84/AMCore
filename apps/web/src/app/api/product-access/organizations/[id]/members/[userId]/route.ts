import { removeOrganizationMember } from '@/entities/organization-context/index.server'
import { assertContextEmptyBody } from '@/shared/api/bff/context-body-budget'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { contextRoute } from '@/shared/api/bff/context-route'
import {
  assertContextMutationOrigin,
  contextRouteInput,
  contextRouteQuery,
} from '@/shared/api/bff/context-route-input'

export function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  return contextRoute(request, async () => {
    assertContextMutationOrigin(request, true)
    if (request.headers.has('content-encoding')) throw new ContextRequestError(400, 'BAD_REQUEST')
    await assertContextEmptyBody(request.body)
    const { id, userId } = await context.params
    return removeOrganizationMember(
      id,
      userId,
      contextRouteQuery(request, 2048),
      contextRouteInput(request)
    )
  })
}
const denied = () => new Response(null, { status: 405, headers: { Allow: 'DELETE' } })
export const GET = denied
export const POST = denied
export const PATCH = denied
export const PUT = denied
export const HEAD = denied
export const OPTIONS = denied
