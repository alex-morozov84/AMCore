import { readOrganizationList } from '@/entities/organization-context/index.server'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { contextMethodNotAllowed, contextRoute } from '@/shared/api/bff/context-route'
import { CONTEXT_SESSION_HEADER } from '@/shared/api/bff/context-session'

export function GET(request: Request): Promise<Response> {
  return contextRoute(request, async () => {
    const query = new URL(request.url).searchParams
    if (
      [...query.keys()].some((key) => key !== 'page') ||
      query.getAll('page').length > 1 ||
      (query.has('page') && !/^[1-9][0-9]*$/.test(query.get('page')!))
    ) {
      throw new ContextRequestError(400, 'BAD_REQUEST')
    }
    return readOrganizationList(Number(query.get('page') ?? 1), {
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
