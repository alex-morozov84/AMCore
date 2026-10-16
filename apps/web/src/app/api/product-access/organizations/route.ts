import { organizationCreationHandlers } from '@/_app/organization-access/index.server'
import { readOrganizationList } from '@/entities/organization-context/index.server'
import { ContextRequestError } from '@/shared/api/bff/context-errors'
import { contextRoute } from '@/shared/api/bff/context-route'
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

const denied = () => new Response(null, { status: 405, headers: { Allow: 'GET, POST' } })
export const HEAD = denied
export const OPTIONS = denied
export const POST = organizationCreationHandlers.create
export const PUT = denied
export const PATCH = denied
export const DELETE = denied
