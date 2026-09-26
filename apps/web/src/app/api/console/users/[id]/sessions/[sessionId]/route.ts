import { handleConsoleUserSessionRevoke } from '@/shared/api/console/users-sessions'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

interface RouteContext {
  params: Promise<{ id: string; sessionId: string }>
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return withConsoleHostGuard(request, async () => {
    const { id, sessionId } = await context.params
    return handleConsoleUserSessionRevoke(request, id, sessionId)
  })
}
