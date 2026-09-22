import { handleConsoleUserRoleUpdate } from '@/shared/api/console/users-role'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return withConsoleHostGuard(request, async () => {
    const { id } = await context.params
    return handleConsoleUserRoleUpdate(request, id)
  })
}
