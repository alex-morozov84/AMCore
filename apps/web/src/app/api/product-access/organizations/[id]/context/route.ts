import { readOrganizationContext } from '@/entities/organization-context/index.server'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { contextMethodNotAllowed, contextRoute } from '@/shared/api/bff/context-route'
import { CONTEXT_SESSION_HEADER } from '@/shared/api/bff/context-session'

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return contextRoute(request, async () => {
    if (new URL(request.url).search !== '') throw new ContextRequestError(400, 'BAD_REQUEST')
    const { id } = await context.params
    return readOrganizationContext(id, {
      expectedSession: request.headers.get(CONTEXT_SESSION_HEADER) ?? undefined,
      headers: request.headers,
      signal: request.signal,
    })
  })
}

export const HEAD = contextMethodNotAllowed
export const OPTIONS = contextMethodNotAllowed
export const POST = contextMethodNotAllowed
export const PUT = contextMethodNotAllowed
export const PATCH = contextMethodNotAllowed
export const DELETE = contextMethodNotAllowed
