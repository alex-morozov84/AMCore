import {
  handleConsoleUserSessionsList,
  handleConsoleUserSessionsRevokeAll,
} from '@/shared/api/console/users-sessions'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return withConsoleHostGuard(request, async () => {
    const { id } = await context.params
    return handleConsoleUserSessionsList(request, id)
  })
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return withConsoleHostGuard(request, async () => {
    const { id } = await context.params
    return handleConsoleUserSessionsRevokeAll(request, id)
  })
}
