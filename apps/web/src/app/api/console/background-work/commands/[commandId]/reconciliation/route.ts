import { handleConsoleWorkCommand } from '@/shared/api/console/background-commands-handler'
import { withConsoleHostGuard } from '@/shared/lib/console-host-guard'

export async function POST(request: Request, context: { params: Promise<{ commandId: string }> }) {
  return withConsoleHostGuard(request, async () => {
    const { commandId } = await context.params
    return handleConsoleWorkCommand(request, commandId, true)
  })
}
