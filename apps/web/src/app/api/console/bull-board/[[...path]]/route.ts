import { handleConsoleBoard } from '@/shared/api/console/board-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

interface RouteContext {
  params: Promise<{ path?: string[] }>
}

/** The board is a view: GET and HEAD only. Every other method is refused before any upstream work. */
function readOnly(request: Request, context: RouteContext): Promise<Response> {
  return withConsoleHostGuard(request, async () =>
    handleConsoleBoard(request, (await context.params).path ?? [])
  )
}

function refused(request: Request): Promise<Response> {
  return withConsoleHostGuard(
    request,
    async () => new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
  )
}

export const GET = readOnly
export const HEAD = readOnly
export const POST = refused
export const PUT = refused
export const PATCH = refused
export const DELETE = refused
export const OPTIONS = refused
